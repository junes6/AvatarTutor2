// 한국어 입력 코칭 — 핵심 학습 루프.
// 학습자가 한국어로 쓰면 대화는 그대로 이어가되, 말풍선 아래에 접힌 카드를 붙인다.

import { loadPrompt } from "./prompts";
import { chatLLM } from "./llm";
import { parseJsonLoose } from "./pipeline/parse";
import { escapePromptData } from "./pipeline/systemPrompt";
import { getPersona } from "./content";
import { getTutorState, getUser, intimacyLevel } from "./gamification";
import type { ChatMessage, CoachingCard } from "./types";

/** 한글이 라틴 문자보다 많으면 한국어 발화로 본다 (혼용 입력 포함). */
export function isKoreanDominant(text: string): boolean {
  const korean = text.match(/[가-힣]/g)?.length ?? 0;
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0;
  return korean > 0 && korean >= latin;
}

/** 코칭 카드가 의미 있으려면 최소한의 내용이 있어야 한다. */
export function needsCoaching(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2) return false;
  if (!isKoreanDominant(trimmed)) return false;
  // "ㅋㅋ", "ㅇㅇ" 같은 리액션에는 카드를 붙이지 않는다.
  return /[가-힣]{2,}/.test(trimmed);
}

interface RawCard {
  primary?: { en?: unknown; ko?: unknown };
  variants?: { style?: unknown; en?: unknown; ko?: unknown }[];
  tip?: unknown;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSentence(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9']+/g, " ").trim();
}

export function sanitizeCoachingCard(raw: unknown, source: string): CoachingCard | null {
  const parsed = raw as RawCard | null;
  const primaryEn = text(parsed?.primary?.en);
  if (!primaryEn) return null;

  const variants: CoachingCard["variants"] = [];
  const seen = new Set([normalizeSentence(primaryEn)]);
  for (const variant of parsed?.variants ?? []) {
    const en = text(variant?.en);
    if (!en) continue;
    // primary와 같은 문장을 "변형"으로 두 번 보여주면 카드가 거짓말을 한다.
    const key = normalizeSentence(en);
    if (seen.has(key)) continue;
    const style = variant?.style === "polite" ? "polite" : "casual";
    if (variants.some((item) => item.style === style)) continue;
    seen.add(key);
    variants.push({ style, en, ko: text(variant?.ko) });
  }
  // 정중/캐주얼 중 하나만 왔다면 primary를 반대편 자리에 채우지 않는다 —
  // 같은 문장 두 개를 보여주느니 하나만 보여주는 편이 정직하다.
  return {
    source,
    primary: { en: primaryEn, ko: text(parsed?.primary?.ko) },
    variants,
    tip: text(parsed?.tip) || undefined,
  };
}

export interface CoachingInput {
  tutorId: string;
  learnerText: string;
  recent: ChatMessage[];
  /** 외부 채널(카카오)에서는 로컬 프로필·친밀도를 읽지 않고 중립값을 쓴다. */
  externalConversation?: boolean;
  signal?: AbortSignal;
}

function formatContext(messages: ChatMessage[], tutorName: string): string {
  if (messages.length === 0) return "(첫 메시지)";
  return messages
    .slice(-6)
    .map((message) => `${message.role === "user" ? "학습자" : tutorName}: ${escapePromptData(message.text)}`)
    .join("\n");
}

/**
 * 카드 생성은 답장 생성과 독립적이다. 실패해도 대화는 그대로 흘러가야 하므로
 * 예외를 삼키고 null을 반환한다 (호출자가 카드 없이 진행).
 */
export async function buildCoachingCard(input: CoachingInput): Promise<CoachingCard | null> {
  if (!needsCoaching(input.learnerText)) return null;

  const persona = getPersona(input.tutorId);
  const external = input.externalConversation === true;
  const user = external ? null : getUser();
  const intimacy = external ? 1 : intimacyLevel(getTutorState(input.tutorId).intimacyXp);

  const system = loadPrompt("coaching-card", {
    name: persona.name,
    personality: escapePromptData(persona.personality),
    learnerName: user?.name || "친구",
    level: String(user?.level ?? 2),
    intimacy: String(intimacy),
    intimacyTone: persona.toneByIntimacy[String(intimacy)] ?? persona.toneByIntimacy["1"],
    recentContext: formatContext(input.recent, persona.name),
    learnerText: escapePromptData(input.learnerText),
  });

  try {
    const result = await chatLLM({
      system,
      messages: [{ role: "user", content: "코칭 카드를 만들어 주세요." }],
      maxTokens: 600,
      feature: "coaching-card",
      signal: input.signal,
    });
    return sanitizeCoachingCard(parseJsonLoose(result.text), input.learnerText);
  } catch (error) {
    console.error("[coaching] card generation failed:", error);
    return null;
  }
}

/** "따라 써보기"를 눌렀을 때 입력창에 깔아 줄 문장. */
export function practiceHint(card: CoachingCard, style?: "casual" | "polite"): string {
  if (style) {
    const variant = card.variants.find((item) => item.style === style);
    if (variant) return variant.en;
  }
  return card.primary.en;
}

/**
 * 학습자가 코칭 문장을 실제로 영어로 다시 썼는지 판정한다.
 * 통과하면 튜터가 칭찬하고 XP를 준다. 완벽한 일치를 요구하지 않는다.
 */
export function matchesPracticeTarget(target: string, attempt: string): boolean {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9' ]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 1);

  const targetWords = normalize(target);
  const attemptWords = new Set(normalize(attempt));
  if (targetWords.length === 0 || attemptWords.size === 0) return false;
  const hits = targetWords.filter((word) => attemptWords.has(word)).length;
  return hits / targetWords.length >= 0.6;
}

export const PRACTICE_XP = 6;
