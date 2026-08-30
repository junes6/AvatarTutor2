// 학습자 프로필 파싱 — 온보딩과 설정에서 같은 검증을 쓴다.

import { isAgeBand, isGoal, isInterestTag, isOccupation, isTemperament } from "./tags";
import type { LearnerProfile } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseProfile(value: unknown): LearnerProfile | null {
  if (!isRecord(value)) return null;
  if (!isAgeBand(value.ageBand)) return null;
  if (!isOccupation(value.occupation)) return null;
  if (!isGoal(value.goal)) return null;
  if (!isTemperament(value.style)) return null;
  const interests = Array.isArray(value.interests) ? value.interests.filter(isInterestTag) : [];
  if (interests.length === 0 || interests.length > 5) return null;
  return {
    ageBand: value.ageBand,
    occupation: value.occupation,
    // 관심사는 3개까지만 매칭에 쓴다 (온보딩 안내와 동일).
    interests: [...new Set(interests)].slice(0, 3),
    goal: value.goal,
    style: value.style,
  };
}

/** 사용자가 지운 이름/공백만 남은 이름을 걸러 내는 공통 정규화. */
export function sanitizeName(value: unknown, maxLength = 24): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned.length > maxLength) return null;
  return cleaned;
}
