// 상황극 — 시작 전 브리핑 카드와, 대화가 상황에서 벗어났을 때의 복구 판정.
// 파일 I/O 없이 순수 함수로 유지해 단독 테스트가 가능하다.

import { getScenario, getScenarios } from "./content";
import type { RoleplayBriefing, Scenario, TurnLog } from "./types";

/** 시나리오 8종은 전부 잠금 해제 상태로 둔다. */
export function availableScenarios(): Scenario[] {
  return getScenarios().map((scenario) => ({ ...scenario, locked: false }));
}

export function buildBriefing(scenarioId: string): RoleplayBriefing | null {
  const scenario = getScenario(scenarioId);
  if (!scenario) return null;
  return {
    scenarioId: scenario.id,
    titleKo: scenario.titleKo,
    situationKo: scenario.descriptionKo,
    learnerRoleKo: scenario.learnerRole,
    tutorRoleKo: scenario.tutorRole,
    missionKo: scenario.goalKo,
    expressions: scenario.keyExpressions ?? [],
  };
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9' ]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2);
}

/** 시나리오가 다루는 어휘 집합 — 제목·역할·흐름·핵심 표현에서 모은다. */
export function scenarioVocabulary(scenario: Scenario): Set<string> {
  const source = [
    scenario.title,
    scenario.openingLine,
    ...scenario.conversationFlow,
    ...(scenario.keyExpressions ?? []).map((expression) => expression.en),
  ].join(" ");
  return new Set(words(source));
}

const STOPWORDS = new Set(["the", "and", "you", "your", "for", "can", "could", "would", "with", "have", "get", "please", "that", "this"]);

function isKoreanDominant(text: string): boolean {
  const korean = text.match(/[가-힣]/g)?.length ?? 0;
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0;
  return korean > 0 && korean >= latin;
}

/**
 * 한 발화가 상황에서 벗어났는지 보수적으로 판정한다.
 * 짧은 대답(yes / sure / two)은 정상적인 진행이므로 이탈로 보지 않는다.
 */
export function isOffTopic(text: string, vocabulary: Set<string>): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (isKoreanDominant(trimmed)) return true;
  const tokens = words(trimmed);
  if (tokens.length === 0) return true;
  // 아주 짧은 응답은 앞 질문에 대한 답일 가능성이 높다.
  if (tokens.length <= 2) return false;
  const overlap = tokens.filter((token) => !STOPWORDS.has(token) && vocabulary.has(token));
  return overlap.length === 0;
}

/** 마지막 학습자 발화부터 연속 몇 번 상황에서 벗어났는지. */
export function offTopicStreak(turns: TurnLog[], scenario: Scenario): number {
  const vocabulary = scenarioVocabulary(scenario);
  let streak = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn.role !== "user") continue;
    if (!isOffTopic(turn.text, vocabulary)) break;
    streak++;
    if (streak >= 3) break;
  }
  return streak;
}

export const RECOVERY_THRESHOLD = 2;

/** 2턴 연속 이탈이면 잠깐 역할을 벗고 한국어 힌트를 준 뒤 복귀하라는 지침. */
export function recoveryHint(streak: number, scenario: Scenario): string {
  if (streak < RECOVERY_THRESHOLD) return "";
  const example = scenario.keyExpressions?.[0];
  return [
    `학습자가 ${streak}턴 연속으로 상황과 무관한 답을 하고 있습니다.`,
    "이번 턴에만 잠깐 역할을 벗으세요:",
    "reply_ko에 지금 무엇을 하면 되는지 한국어로 한 줄 설명하고,",
    example ? `suggestion에 "${example.en}" (${example.ko}) 처럼 바로 따라 말할 수 있는 문장 하나를 넣으세요.` : "suggestion에 바로 따라 말할 수 있는 문장 하나를 넣으세요.",
    "reply는 역할 대사 한 문장으로 짧게 복귀하세요. 나무라지 말고 부드럽게 안내하세요.",
  ].join(" ");
}
