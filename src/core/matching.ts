// 궁합 엔진 — 프로필 매칭 + 행동 신호.
// 파일 I/O 없이 순수 함수로만 구성해 `tsx scripts/simulate.ts --matching` 으로 단독 검증한다.

import { ageDistance } from "./tags";
import type {
  LearnerProfile,
  MatchScore,
  MatchingModel,
  RelationshipStats,
  LeaveReason,
  TutorPersona,
  Tempo,
  Temperament,
} from "./types";

export const EMPTY_MODEL: MatchingModel = { weights: {}, updatedAt: 0 };

const WEIGHT_LIMIT = 30;
const DECAY = 0.9;

/** 페르소나를 궁합 모델이 학습할 수 있는 태그 키 집합으로 편다. */
export function tagKeys(persona: TutorPersona): string[] {
  const { tags } = persona;
  return [
    `temperament:${tags.temperament}`,
    `tempo:${tags.tempo}`,
    `age:${tags.ageBand}`,
    `country:${tags.country}`,
    `occupation:${tags.occupation}`,
    ...tags.interests.map((interest) => `interest:${interest}`),
    ...tags.goals.map((goal) => `goal:${goal}`),
  ];
}

/** 성향 선택이 곧 템포 선호를 함의한다 — 활발한 친구를 고르면 빠른 템포가 어울린다. */
function tempoFit(style: Temperament, tempo: Tempo): number {
  if (tempo === "medium") return 5;
  const preferred: Tempo = style === "lively" ? "fast" : "slow";
  return tempo === preferred ? 10 : 0;
}

function ageScore(distance: number): number {
  if (distance === 0) return 14;
  if (distance === 1) return 7;
  if (distance === 2) return 2;
  return 0;
}

/** 지속 대화·통화는 긍정, 단답 반복과 무응답은 부정. */
export function engagementScore(stats: RelationshipStats | undefined, now = Date.now()): number {
  if (!stats) return 0;
  let score = 0;
  score += Math.min(12, stats.longestStreakTurns * 1.5);
  score += Math.min(10, stats.calls * 4);
  score += Math.min(8, Math.round(stats.callSeconds / 120));
  score -= Math.min(14, stats.shortReplies * 2);

  if (stats.lastLearnerMessageAt > 0) {
    const silentDays = (now - stats.lastLearnerMessageAt) / 86_400_000;
    if (silentDays >= 3) score -= Math.min(16, Math.round(silentDays) * 3);
  }
  const answered = stats.tutorMessages > 0 ? stats.learnerMessages / stats.tutorMessages : 0;
  if (stats.tutorMessages >= 4) score += Math.round((Math.min(1.2, answered) - 0.5) * 14);
  return score;
}

export interface ScoreOptions {
  stats?: RelationshipStats;
  now?: number;
  /** 새 친구 후보를 고를 때는 관계 기록이 없으므로 행동 점수를 빼고 본다. */
  includeEngagement?: boolean;
}

export function scoreTutor(
  persona: TutorPersona,
  profile: LearnerProfile,
  model: MatchingModel = EMPTY_MODEL,
  options: ScoreOptions = {},
): MatchScore {
  const reasons: string[] = [];
  let score = 0;

  const shared = persona.tags.interests.filter((interest) => profile.interests.includes(interest));
  const interestScore = Math.min(45, shared.length * 15);
  if (interestScore > 0) {
    score += interestScore;
    reasons.push(`관심사 ${shared.length}개 겹침`);
  }

  if (persona.tags.goals.includes(profile.goal)) {
    score += 20;
    reasons.push("학습 목적이 맞음");
  }

  if (persona.tags.temperament === profile.style) {
    score += 18;
    reasons.push(profile.style === "calm" ? "차분한 대화 스타일" : "활발한 대화 스타일");
  }

  const distance = ageDistance(persona.tags.ageBand, profile.ageBand);
  const age = ageScore(distance);
  if (age > 0) {
    score += age;
    if (distance === 0) reasons.push("같은 연령대");
  }

  if (persona.tags.occupation === profile.occupation) {
    score += 8;
    reasons.push("비슷한 일상");
  }

  score += tempoFit(profile.style, persona.tags.tempo);

  // 행동 신호로 학습된 태그 가중치
  let learned = 0;
  for (const key of tagKeys(persona)) learned += model.weights[key] ?? 0;
  score += learned;
  if (learned <= -8) reasons.push("최근 반응이 아쉬웠던 유형");
  else if (learned >= 8) reasons.push("잘 맞았던 유형");

  if (options.includeEngagement !== false) {
    score += engagementScore(options.stats, options.now);
  }

  return { tutorId: persona.id, score: Math.round(score), reasons };
}

export interface RankInput {
  personas: TutorPersona[];
  profile: LearnerProfile;
  model?: MatchingModel;
  stats?: Record<string, RelationshipStats>;
  exclude?: string[];
  includeEngagement?: boolean;
  now?: number;
}

export function rankTutors(input: RankInput): MatchScore[] {
  const exclude = new Set(input.exclude ?? []);
  return input.personas
    .filter((persona) => !exclude.has(persona.id))
    .map((persona) =>
      scoreTutor(persona, input.profile, input.model ?? EMPTY_MODEL, {
        stats: input.stats?.[persona.id],
        now: input.now,
        includeEngagement: input.includeEngagement,
      }),
    )
    // 동점일 때 순서가 흔들리지 않도록 id로 안정 정렬한다.
    .sort((a, b) => b.score - a.score || a.tutorId.localeCompare(b.tutorId));
}

function applyWeights(model: MatchingModel, deltas: Record<string, number>): MatchingModel {
  const weights: Record<string, number> = {};
  for (const [key, value] of Object.entries(model.weights)) {
    const decayed = value * DECAY;
    if (Math.abs(decayed) >= 0.5) weights[key] = Math.round(decayed * 10) / 10;
  }
  for (const [key, delta] of Object.entries(deltas)) {
    const next = (weights[key] ?? 0) + delta;
    weights[key] = Math.round(Math.max(-WEIGHT_LIMIT, Math.min(WEIGHT_LIMIT, next)) * 10) / 10;
  }
  return { weights, updatedAt: Date.now() };
}

const OPPOSITE_TEMPERAMENT: Record<Temperament, Temperament> = { calm: "lively", lively: "calm" };

/**
 * 채팅방 나가기는 가장 강한 부정 신호다. 사유별로 어떤 축을 밀지 다르게 잡는다.
 * (예: 활발한 성향에서 이탈 → 차분한 성향 가중)
 */
export function updateModelOnLeave(
  model: MatchingModel,
  persona: TutorPersona,
  reason: LeaveReason,
): MatchingModel {
  const { tags } = persona;
  const deltas: Record<string, number> = {};
  const bump = (key: string, value: number) => {
    deltas[key] = (deltas[key] ?? 0) + value;
  };

  // 어떤 사유든 그 친구가 대표하는 조합 자체는 한 번 눌러 둔다.
  bump(`temperament:${tags.temperament}`, -6);
  bump(`tempo:${tags.tempo}`, -4);
  for (const interest of tags.interests) bump(`interest:${interest}`, -1.5);

  switch (reason) {
    case "mismatch":
      bump(`temperament:${tags.temperament}`, -8);
      bump(`temperament:${OPPOSITE_TEMPERAMENT[tags.temperament]}`, 10);
      bump(`age:${tags.ageBand}`, -4);
      break;
    case "too-hard":
      // 말이 빠르고 어려웠다는 뜻 — 느린 템포와 차분한 성향을 밀어 준다.
      bump("tempo:fast", -10);
      bump("tempo:slow", 10);
      bump("temperament:calm", 6);
      break;
    case "too-easy":
      bump("tempo:slow", -10);
      bump("tempo:fast", 8);
      bump("age:30s", 4);
      bump("age:40s", 3);
      break;
    case "slow":
      // 응답이 느렸다 — 같은 템포 유형을 강하게 누르고 빠른 친구를 올린다.
      bump(`tempo:${tags.tempo}`, -10);
      bump("tempo:fast", 10);
      break;
    default:
      break;
  }
  return applyWeights(model, deltas);
}

/** 대화가 잘 이어지면 그 조합을 조금씩 강화한다. */
export function updateModelOnEngagement(
  model: MatchingModel,
  persona: TutorPersona,
  stats: RelationshipStats,
  now = Date.now(),
): MatchingModel {
  const signal = engagementScore(stats, now);
  if (Math.abs(signal) < 6) return model;
  const direction = signal > 0 ? 1 : -1;
  const magnitude = Math.min(4, Math.abs(signal) / 6) * direction;
  const deltas: Record<string, number> = {
    [`temperament:${persona.tags.temperament}`]: magnitude,
    [`tempo:${persona.tags.tempo}`]: magnitude * 0.7,
  };
  for (const interest of persona.tags.interests) {
    deltas[`interest:${interest}`] = magnitude * 0.4;
  }
  return applyWeights(model, deltas);
}

/** 0~100 표시용 정규화 (원점수는 대략 -40~120 범위) */
export function normalizedScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(((score + 20) / 140) * 100)));
}
