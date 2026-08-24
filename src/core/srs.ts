// 간격 반복(SRS) — 표현별 복습 큐. 당일(0) → 3일(1) → 7일(2) → 졸업(3)

import { readJSON, writeJSON, todayStr, addDays, uid } from "./store";
import type { SrsItem } from "./types";

const STAGE_INTERVALS = [0, 3, 7]; // stage n 통과 시 다음 due까지 일수

export function getSrsQueue(): SrsItem[] {
  return readJSON<{ items: SrsItem[] }>("srs", { items: [] }).items;
}

function save(items: SrsItem[]) {
  writeJSON("srs", { items });
}

/** 유닛 학습 완료 시 표현들을 큐에 등록 (당일 복습부터) */
export function enqueueExpressions(unitId: string, expressionIds: string[]) {
  const items = getSrsQueue();
  const today = todayStr();
  for (const expressionId of expressionIds) {
    if (items.some((i) => i.expressionId === expressionId)) continue;
    items.push({ id: uid("srs"), expressionId, unitId, due: today, stage: 0, lapses: 0 });
  }
  save(items);
}

/** 오늘 복습할 항목 (due가 오늘 이전) */
export function getDueItems(limit = 3): SrsItem[] {
  const today = todayStr();
  return getSrsQueue()
    .filter((i) => i.stage < 3 && i.due <= today)
    .sort((a, b) => a.due.localeCompare(b.due))
    .slice(0, limit);
}

/** 복습 결과 반영 */
export function reviewResult(expressionId: string, pass: boolean) {
  const items = getSrsQueue();
  const item = items.find((i) => i.expressionId === expressionId);
  if (!item) return;
  if (pass) {
    item.stage += 1;
    if (item.stage < 3) {
      item.due = addDays(todayStr(), STAGE_INTERVALS[item.stage] ?? 7);
    }
  } else {
    item.lapses += 1;
    item.stage = 0;
    item.due = todayStr(); // 오늘 다시
  }
  save(items);
}
