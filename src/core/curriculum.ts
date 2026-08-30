import type { Unit } from "./types";

export type UnitRecommendationReason = "matched" | "next-step" | "review";

export interface UnitRecommendation {
  unit: Unit;
  reason: UnitRecommendationReason;
}

function normalizedLevel(level: number): number {
  const safe = Number.isFinite(level) ? Math.round(level) : 2;
  return Math.max(1, Math.min(5, safe));
}

function byLevelThenOrder(a: Unit, b: Unit): number {
  return a.level - b.level || a.order - b.order || a.id.localeCompare(b.id);
}

/**
 * 현재 회화 수준에 맞는 미완료 유닛을 고른다. 같은 수준을 우선하고, 없으면
 * 다음 도전 수준, 그것도 없으면 가장 가까운 아래 수준 복습으로 돌아간다.
 * JSON 배열 순서에는 의존하지 않는다.
 */
export function recommendUnit(
  units: readonly Unit[],
  completedUnitIds: readonly string[],
  learnerLevel: number,
): UnitRecommendation | null {
  const level = normalizedLevel(learnerLevel);
  const completed = new Set(completedUnitIds);
  const available = units.filter((unit) => !completed.has(unit.id)).sort(byLevelThenOrder);
  if (available.length === 0) return null;

  const matched = available.find((unit) => unit.level === level);
  if (matched) return { unit: matched, reason: "matched" };

  const nextStep = available.find((unit) => unit.level > level);
  if (nextStep) return { unit: nextStep, reason: "next-step" };

  const closestReviewLevel = Math.max(...available.map((unit) => unit.level));
  const review = available.find((unit) => unit.level === closestReviewLevel);
  return review ? { unit: review, reason: "review" } : null;
}
