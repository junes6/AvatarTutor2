// Kakao i Open Builder skill endpoint.
// Register /api/kakao/skill?tutor=<personaId> as a fallback block skill to run a
// Kakao-isolated tutor conversation inside KakaoTalk. Korean input coaching is
// mapped onto Kakao's itemCard so the learning loop survives the channel change.

import { createHash, timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { chatTurn, chatTurnWithDelivery, type ChatTurnResult } from "@/core/chat";
import { getPersona, getPersonas } from "@/core/content";
import type { CoachingCard } from "@/core/types";

interface KakaoSkillRequest {
  userRequest?: {
    utterance?: string;
    callbackUrl?: string;
    user?: { id?: string; properties?: Record<string, string> };
  };
  action?: {
    params?: Record<string, string>;
    clientExtra?: Record<string, unknown>;
  };
}

// 8명 전원을 카카오 채널에서도 고를 수 있게 한다 (?tutor= 파라미터).
const ALLOWED_TUTORS = new Set(getPersonas().map((persona) => persona.id));
const GENERATION_TIMEOUT_MS = 40_000;
const SYNC_RESPONSE_TIMEOUT_MS = 4_000;
const CALLBACK_TIMEOUT_MS = 7_000;
const MAX_UTTERANCE_LENGTH = 2_000;
const MAX_REQUEST_BYTES = 64 * 1024;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export const maxDuration = 60;

const QUICK_REPLIES = [
  { action: "message", label: "천천히 말해줘", messageText: "Could you say that more slowly?" },
  { action: "message", label: "표현 하나 알려줘", messageText: "Teach me one useful expression." },
  { action: "message", label: "대화 계속하기", messageText: "Let's keep talking." },
];

type KakaoOutput = Record<string, unknown>;

function envelope(outputs: KakaoOutput[], tutorId: string) {
  return {
    version: "2.0",
    // 카카오는 한 응답에 최대 3개의 output만 허용한다.
    template: { outputs: outputs.slice(0, 3), quickReplies: QUICK_REPLIES },
    data: { tutorId },
  };
}

function skillResponse(text: string, tutorId: string) {
  return envelope([{ simpleText: { text: text.slice(0, 1000) } }], tutorId);
}

const VARIANT_LABEL: Record<CoachingCard["variants"][number]["style"], string> = {
  casual: "편하게",
  polite: "정중하게",
};

/** 한국어 입력 코칭 카드를 카카오 itemCard로 매핑한다. */
function coachingCard(card: CoachingCard): KakaoOutput {
  const itemList = [
    { title: "자연스럽게", description: card.primary.en.slice(0, 100) },
    ...card.variants.map((variant) => ({
      title: VARIANT_LABEL[variant.style],
      description: variant.en.slice(0, 100),
    })),
  ].slice(0, 5);

  return {
    itemCard: {
      head: { title: "영어로는 이렇게 말해요" },
      itemList,
      itemListAlignment: "left",
      description: [card.primary.ko, card.tip].filter(Boolean).join(" · ").slice(0, 230),
      buttons: [
        { action: "message", label: "따라 써보기", messageText: card.primary.en.slice(0, 200) },
      ],
      buttonLayout: "vertical",
    },
  };
}

function turnResponse(result: ChatTurnResult, tutorId: string) {
  const outputs: KakaoOutput[] = [{ simpleText: { text: formatTutorResponse(result).slice(0, 1000) } }];
  if (result.coaching) outputs.push(coachingCard(result.coaching));
  return envelope(outputs, tutorId);
}

function safeSecretMatches(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function consumeRateLimit(key: string): boolean {
  const now = Date.now();
  if (rateBuckets.size > 2_048) {
    for (const [bucketKey, bucket] of rateBuckets) {
      if (bucket.resetAt <= now) rateBuckets.delete(bucketKey);
    }
    while (rateBuckets.size > 4_096) {
      const oldestKey = rateBuckets.keys().next().value as string | undefined;
      if (!oldestKey) break;
      rateBuckets.delete(oldestKey);
    }
  }
  const current = rateBuckets.get(key);
  if (!current || current.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (current.count >= RATE_LIMIT_MAX_REQUESTS) return false;
  current.count += 1;
  return true;
}

function trustedCallbackUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const kakaoHost = url.hostname === "kakao.com" || url.hostname.endsWith(".kakao.com");
    return url.protocol === "https:" && kakaoHost ? url.toString() : null;
  } catch {
    return null;
  }
}

async function tutorResponse(tutorId: string, utterance: string, conversationId: string, signal: AbortSignal): Promise<ChatTurnResult> {
  return chatTurn({ tutorId, text: utterance, conversationId, signal });
}

function formatTutorResponse(result: Pick<ChatTurnResult, "tutorMsg">): string {
  const translated = result.tutorMsg.ko ? `\n\n🇰🇷 ${result.tutorMsg.ko}` : "";
  return `${result.tutorMsg.text}${translated}`;
}

async function postCallback(callbackUrl: string, payload: ReturnType<typeof envelope>) {
  const response = await fetch(callbackUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(CALLBACK_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Kakao callback failed (${response.status})`);
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "AvatarTutor Kakao skill", version: "2.0" });
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const expectedSecret = process.env.KAKAO_SKILL_SECRET ?? "";
  if (process.env.NODE_ENV === "production" && !expectedSecret) {
    return NextResponse.json(skillResponse("카카오 연결 보안 설정이 필요합니다.", "mia"), { status: 503 });
  }
  const providedSecret =
    req.headers.get("x-avatar-tutor-secret") ??
    req.headers.get("x-api-key") ??
    "";
  if (expectedSecret && !safeSecretMatches(providedSecret, expectedSecret)) {
    return NextResponse.json(skillResponse("연결 정보를 확인해 주세요.", "mia"), { status: 401 });
  }
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return NextResponse.json(skillResponse("요청이 너무 커요. 메시지를 짧게 나눠서 보내 주세요.", "mia"), { status: 413 });
  }

  try {
    const body = (await req.json()) as KakaoSkillRequest;
    const params = body.action?.params ?? {};
    const requestedTutor = url.searchParams.get("tutor") || params.tutorId || params.tutor || "mia";
    const tutorId = ALLOWED_TUTORS.has(requestedTutor) ? requestedTutor : "mia";
    const utterance = String(body.userRequest?.utterance ?? "").trim();
    const persona = getPersona(tutorId);

    if (!utterance) {
      return NextResponse.json(skillResponse(`${persona.koName}예요. 오늘은 어떤 영어를 연습해 볼까요?`, tutorId));
    }
    if (utterance.length > MAX_UTTERANCE_LENGTH) {
      return NextResponse.json(skillResponse("메시지가 너무 길어요. 2,000자 이내로 나눠서 보내 주세요.", tutorId));
    }

    const kakaoUserId = String(body.userRequest?.user?.id ?? "").trim();
    if (!kakaoUserId) {
      return NextResponse.json(skillResponse("사용자 정보를 확인할 수 없어 대화를 시작하지 못했어요. 채널에서 다시 시도해 주세요.", tutorId));
    }
    const userHash = createHash("sha256").update(kakaoUserId).digest("hex");
    if (!consumeRateLimit(userHash)) {
      return NextResponse.json(skillResponse("메시지가 너무 빠르게 들어오고 있어요. 잠시 후 다시 보내 주세요.", tutorId));
    }
    const conversationId = `kakao-${userHash.slice(0, 24)}`;
    const callbackUrl = trustedCallbackUrl(body.userRequest?.callbackUrl);

    // AI 챗봇 콜백이 켜진 블록은 먼저 5초 SLA 안에 응답하고, 완성된 답변은
    // Kakao가 발급한 1회성 HTTPS URL로 보낸다. 일반 블록/봇 테스트는 동기 응답한다.
    if (callbackUrl) {
      after(async () => {
        try {
          const signal = AbortSignal.timeout(GENERATION_TIMEOUT_MS);
          await chatTurnWithDelivery(
            tutorId,
            utterance,
            conversationId,
            (result) => postCallback(callbackUrl, turnResponse(result, tutorId)),
            signal,
          );
        } catch (error) {
          console.error("[api/kakao/skill callback]", error);
          try {
            await postCallback(
              callbackUrl,
              skillResponse("잠깐 연결이 불안정해요. 방금 말을 한 번만 다시 보내 주세요.", tutorId),
            );
          } catch (callbackError) {
            console.error("[api/kakao/skill callback fallback]", callbackError);
          }
        }
      });
      return NextResponse.json({
        version: "2.0",
        useCallback: true,
        data: { text: `${persona.koName}가 답변을 만들고 있어요. 잠시만 기다려 주세요.` },
      });
    }

    const result = await tutorResponse(tutorId, utterance, conversationId, AbortSignal.timeout(SYNC_RESPONSE_TIMEOUT_MS));
    return NextResponse.json(turnResponse(result, tutorId));
  } catch (error) {
    console.error("[api/kakao/skill]", error);
    return NextResponse.json(skillResponse("잠깐 연결이 불안정해요. 방금 말을 한 번만 다시 보내 주세요.", "mia"));
  }
}
