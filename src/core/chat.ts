// 채팅 채널 — 메신저 대화의 오케스트레이터.
// 답장을 즉시 반환하지 않고 지연 큐에 예약하는 것이 이 앱의 기본 동작이다.
// (외부 채널과 "지금 대화 중" 토글만 즉시 응답한다.)

import { runTurn } from "./pipeline/turn";
import { summarizeToMemory, chatToTranscript, formatMemory } from "./memory";
import { buildCoachingCard, matchesPracticeTarget, needsCoaching, PRACTICE_XP } from "./coaching";
import { lifeContext, lifeStatus } from "./life";
import { planDelivery, sleepApologyHint, travelDelayHint } from "./rhythm";
import { schedule } from "./deliveryQueue";
import { getPersona } from "./content";
import { addXp, getTutorState, getUser, intimacyLevel } from "./gamification";
import { recordLearnerMessage, recordTutorMessage } from "./friends";
import { config } from "./config";
import { describePhoto } from "./vision";
import { learnerPhoto } from "./photos";
import {
  appendMessages,
  chatKey,
  getChat,
  isLive,
  newMessage,
  previewText,
  touchLive,
} from "./chatStore";
import type {
  ChatMessage,
  ChatPhoto,
  ChatThread,
  CoachingCard,
  CorrectionCard,
  ProactiveType,
  SessionRecord,
} from "./types";

// 한 Node 프로세스 안에서는 같은 대화를 직렬화해 빠른 연속 요청이 서로의
// 히스토리를 덮어쓰지 않게 한다. 다중 인스턴스 운영은 README의 공유 DB/KV
// 요구사항처럼 저장소 수준 트랜잭션이 별도로 필요하다.
const chatQueues = new Map<string, Promise<void>>();

const HISTORY_WINDOW = 24;
const PRACTICE_LOOKBACK = 6;

export interface ChatTurnResult {
  userMsg: ChatMessage;
  tutorMsg: ChatMessage;
  correction: CorrectionCard | null;
  coaching: CoachingCard | null;
  /** 예약 발송이면 도착 예정 시각, 즉시 도착이면 null */
  scheduledFor: number | null;
  /** "입력 중…" 인디케이터를 켤 시각 */
  typingFrom: number | null;
  /** 튜터가 자고 있어서 다음 활동 시간대로 밀렸는가 */
  sleptThrough: boolean;
  /** 학습자가 코칭 문장을 영어로 다시 써서 XP를 받았는가 */
  practiceHit: boolean;
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("chat cancelled");
}

async function waitForChatQueue(previous: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return previous;
  if (signal.aborted) throw abortReason(signal);

  let onAbort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    await Promise.race([previous, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

async function withChatLock<T>(key: string, task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const previous = chatQueues.get(key) ?? Promise.resolve();
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  chatQueues.set(key, tail);
  try {
    await waitForChatQueue(previous, signal);
    if (signal?.aborted) throw abortReason(signal);
    return await task();
  } finally {
    release();
    // When a queued caller is aborted before its predecessor completes, keep
    // the predecessor represented in the map until this tail actually settles.
    void tail.then(() => {
      if (chatQueues.get(key) === tail) chatQueues.delete(key);
    });
  }
}

// ── 하위 호환 재노출 (proactive.ts, API 라우트가 사용) ──
export { chatKey, getChat, saveChat, markRead, unreadCount, previewText, toggleReaction, isLive, setLive } from "./chatStore";

/** 튜터 메시지를 채팅방에 즉시 추가한다 (지연이 필요 없는 경로 전용). */
export function appendTutorMessage(
  tutorId: string,
  text: string,
  ko: string,
  proactiveType?: ProactiveType,
  extra: Partial<ChatMessage> = {},
): ChatMessage {
  const message = newMessage({ role: "tutor", text, ko, read: false, proactiveType, ...extra });
  appendMessages(tutorId, message);
  recordTutorMessage(tutorId);
  return message;
}

/** 튜터의 지금 상황에 맞는 프롬프트 컨텍스트 (근황 + 지연 사유). */
export function tutorSituation(tutorId: string, sleptThroughMs = 0) {
  const status = lifeStatus(tutorId);
  const notes: string[] = [];
  if (sleptThroughMs > 0) notes.push(sleepApologyHint(getPersona(tutorId).rhythm, sleptThroughMs));
  if (status.travelling) notes.push(travelDelayHint(status.city));
  return {
    lifeContext: lifeContext(tutorId),
    deliveryNote: notes.join(" ") || undefined,
    status,
  };
}

function historyFor(thread: ChatThread, tutorId: string): SessionRecord {
  return {
    id: `chat-${tutorId}`,
    tutorId,
    mode: "chat",
    startedAt: Date.now(),
    turns: thread.messages.slice(-HISTORY_WINDOW).map((message) => ({
      id: message.id,
      role: message.role,
      text: message.text,
      ts: message.ts,
      correction: message.correction,
    })),
    corrections: [],
    judgments: [],
    xpEarned: 0,
    pronunciationScores: [],
  };
}

/** 최근 코칭 카드 중 학습자가 방금 따라 쓴 것이 있는지 찾는다. */
function findPracticeHit(thread: ChatThread, attempt: string): CoachingCard | null {
  if (!/[A-Za-z]/.test(attempt)) return null;
  const recent = thread.messages.slice(-PRACTICE_LOOKBACK);
  for (let i = recent.length - 1; i >= 0; i--) {
    const card = recent[i].coaching;
    if (!card) continue;
    const targets = [card.primary.en, ...card.variants.map((variant) => variant.en)];
    if (targets.some((target) => matchesPracticeTarget(target, attempt))) return card;
  }
  return null;
}

export interface ChatTurnInput {
  tutorId: string;
  text: string;
  /** 학습자가 보낸 사진 (data URL) */
  photoDataUrl?: string;
  replyToId?: string;
  /** 외부 채널(카카오)이면 대화 격리 키 */
  conversationId?: string;
  signal?: AbortSignal;
}

export async function chatTurn(input: ChatTurnInput): Promise<ChatTurnResult> {
  const external = input.conversationId !== undefined;
  const key = chatKey(input.tutorId, input.conversationId);
  return withChatLock(
    key,
    async () => {
      const prepared = await prepareChatTurn(input, key, external);
      commitChatTurn(input.tutorId, key, external, prepared);
      return prepared;
    },
    input.signal,
  );
}

/** Callback delivery succeeds before the externally visible turn is committed. */
export async function chatTurnWithDelivery(
  tutorId: string,
  userText: string,
  conversationId: string,
  deliver: (result: ChatTurnResult) => Promise<void>,
  signal?: AbortSignal,
): Promise<ChatTurnResult> {
  const key = chatKey(tutorId, conversationId);
  return withChatLock(
    key,
    async () => {
      const prepared = await prepareChatTurn({ tutorId, text: userText, conversationId, signal }, key, true);
      await deliver(prepared);
      // Once delivery succeeds, commit even if the generation deadline expires
      // in the same tick; the user has already seen this exact response.
      commitChatTurn(tutorId, key, true, prepared);
      return prepared;
    },
    signal,
  );
}

async function prepareChatTurn(
  input: ChatTurnInput,
  key: string,
  external: boolean,
): Promise<ChatTurnResult> {
  const { signal } = input;
  if (signal?.aborted) throw abortReason(signal);
  const thread = getChat(key);
  const now = Date.now();

  // 사진을 먼저 인식해야 튜터가 "보고" 답할 수 있다.
  let photo: ChatPhoto | null = null;
  let photoNote = "";
  if (input.photoDataUrl) {
    const description = await describePhoto(input.photoDataUrl);
    photo = learnerPhoto(input.photoDataUrl, description ?? "학습자가 보낸 사진");
    photoNote = description
      ? `학습자가 사진을 보냈습니다. 사진 속 내용: ${description}`
      : "학습자가 사진을 보냈지만 무엇이 찍혔는지 인식하지 못했습니다. 가볍게 무엇인지 되물으세요.";
  }

  const promptText = photoNote
    ? `${input.text.trim() ? `${input.text.trim()}\n` : ""}(${photoNote})`
    : input.text;

  const practiceCard = external ? null : findPracticeHit(thread, input.text);
  const turnNotes: string[] = [];
  if (practiceCard) {
    turnNotes.push(
      `학습자가 방금 배운 표현("${practiceCard.primary.en}")을 직접 영어로 다시 썼습니다. 구체적으로 칭찬한 뒤 그 흐름으로 대화를 이어가세요.`,
    );
  }
  if (photoNote) turnNotes.push("학습자의 사진에 구체적으로 반응하고 질문은 하나만 하세요.");

  const situation = external
    ? { lifeContext: undefined, deliveryNote: undefined, status: null }
    : tutorSituation(input.tutorId);

  const session = historyFor(thread, input.tutorId);
  // 답장 생성과 코칭 카드는 서로 독립적이므로 동시에 돌린다.
  const [result, coaching] = await Promise.all([
    runTurn({
      session,
      userText: promptText,
      externalConversation: external,
      lifeContext: situation.lifeContext,
      deliveryNote: situation.deliveryNote,
      turnNotes,
      signal,
    }),
    // 코칭 카드는 외부 채널(카카오)에서도 핵심 학습 가치라 함께 만들되,
    // 그쪽에서는 로컬 프로필을 읽지 않는 중립 컨텍스트를 쓴다.
    !needsCoaching(input.text) || (!external && !getUser().settings.coachingCards)
      ? Promise.resolve(null)
      : buildCoachingCard({
          tutorId: input.tutorId,
          learnerText: input.text,
          recent: thread.messages,
          externalConversation: external,
          signal,
        }),
  ]);
  if (signal?.aborted) throw abortReason(signal);

  const replyTo = input.replyToId
    ? thread.messages.find((message) => message.id === input.replyToId)
    : undefined;

  const userMsg: ChatMessage = newMessage({
    role: "user",
    kind: photo ? "photo" : "text",
    text: input.text,
    photo,
    correction: result.correction,
    coaching,
    replyTo: replyTo
      ? { id: replyTo.id, role: replyTo.role, preview: previewText(replyTo).slice(0, 90) }
      : null,
    ts: now,
    read: true,
  });

  // 지연 큐에서 도착시킬 때는 ts를 도착 시각으로 다시 찍는다.
  const tutorMsg: ChatMessage = newMessage({
    role: "tutor",
    text: result.reply,
    ko: result.reply_ko,
    ts: now,
    read: false,
  });

  const live = external || !config.chat.delayEnabled || isLive(key, now);
  const plan = live
    ? { dueAt: now, typingFrom: now, sleptThrough: false, band: "instant" as const }
    : planDelivery({
        rhythm: getPersona(input.tutorId).rhythm,
        text: result.reply,
        timezone: situation.status?.timezone,
        travelling: situation.status?.travelling,
        now,
      });

  return {
    userMsg,
    tutorMsg,
    correction: result.correction,
    coaching,
    scheduledFor: live ? null : plan.dueAt,
    typingFrom: live ? null : plan.typingFrom,
    sleptThrough: plan.sleptThrough,
    practiceHit: Boolean(practiceCard),
  };
}

function commitChatTurn(tutorId: string, key: string, external: boolean, result: ChatTurnResult) {
  // LLM/외부 전달을 기다리는 동안 예약 도착/읽음 처리가 들어왔을 수 있으므로
  // 최신 스냅샷에 원자적으로 append한다.
  if (result.scheduledFor === null) {
    // 즉시 응답은 한 번의 읽기-쓰기로 붙여, 예약 도착과 순서가 엇갈리지 않게 한다.
    appendMessages(key, result.userMsg, result.tutorMsg);
  } else {
    appendMessages(key, result.userMsg);
    const persona = getPersona(tutorId);
    schedule({
      tutorId,
      message: result.tutorMsg,
      dueAt: result.scheduledFor,
      typingFrom: result.typingFrom ?? result.scheduledFor,
      reason: "reply",
      push: {
        title: persona.koName,
        body: result.tutorMsg.text.slice(0, 120),
        url: `/chat/${tutorId}`,
      },
    });
  }

  if (!external) {
    recordLearnerMessage(tutorId, result.userMsg.text);
    recordTutorMessage(tutorId);
    touchLive(key);
    if (result.practiceHit) addXp(PRACTICE_XP);
  }

  // 대화가 쌓이면 주기적으로 기억 요약 (12개 메시지마다)
  const latest = getChat(key);
  if (!external && latest.messages.length % 12 === 0) {
    summarizeToMemory(tutorId, chatToTranscript(latest.messages.slice(-20))).catch(() => {});
  }
}

/** 능동 메시지·라이프 포스트가 공유하는 페르소나 컨텍스트. */
export function personaContext(tutorId: string) {
  const persona = getPersona(tutorId);
  const user = getUser();
  const intimacy = intimacyLevel(getTutorState(tutorId).intimacyXp);
  return {
    persona,
    learnerName: user.name || "친구",
    level: user.level,
    intimacy,
    intimacyTone: persona.toneByIntimacy[String(intimacy)] ?? persona.toneByIntimacy["1"],
    memory: formatMemory(tutorId),
  };
}

/** 통화가 끝나면 대화 내용이 채팅방에 요약 카드로 남는다. */
export function appendCallSummary(tutorId: string, summary: ChatMessage["callSummary"]): ChatMessage | null {
  if (!summary) return null;
  const minutes = Math.max(1, Math.round(summary.durationSec / 60));
  const message = newMessage({
    role: "tutor",
    kind: "call-summary",
    text: `통화 ${minutes}분 · ${summary.turns}문장`,
    callSummary: summary,
    ts: Date.now(),
    read: true,
  });
  appendMessages(tutorId, message);
  return message;
}
