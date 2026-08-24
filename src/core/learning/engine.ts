// 러닝모드 단계 엔진 — LLM의 stage_signal을 받아 단계를 진행하되,
// LLM이 신호를 놓쳐도 세션이 멈추지 않도록 안전장치(턴 상한)를 둔다.

import { getUnit } from "../content";
import { getDueItems, reviewResult } from "../srs";
import { findExpression } from "../content";
import type { StageState, TutorTurnOutput, Judgment, LearningStage } from "../types";

const STAGE_ORDER: LearningStage[] = ["review", "intro", "practice", "roleplay", "done"];
const MAX_TURNS: Record<LearningStage, number> = {
  review: 10,
  intro: 16,
  practice: 14,
  roleplay: 12,
  done: 99,
};

export function initStageState(): StageState {
  const due = getDueItems(3);
  const reviewItems = due
    .map((item) => {
      const found = findExpression(item.expressionId);
      return found ? { expressionId: item.expressionId, en: found.expr.en, ko: found.expr.ko } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  return {
    stage: reviewItems.length > 0 ? "review" : "review", // 복습 없으면 conductor가 즉시 advance
    reviewItems,
    reviewIndex: 0,
    introIndex: 0,
    practicedIds: [],
    roleplayUsedIds: [],
    turnsInStage: 0,
    combo: 0,
  };
}

export interface StageOutcome {
  xpGained: number;
  events: string[]; // UI 이펙트 트리거: "review-pass" | "expression-used" | "stage-advance" | "unit-clear"
}

/** 튜터 턴 결과를 단계 상태에 반영. session의 stageState를 직접 수정한다. */
export function applyTurn(
  st: StageState,
  unitId: string,
  output: TutorTurnOutput,
  judgment: Judgment | undefined,
): StageOutcome {
  const outcome: StageOutcome = { xpGained: 0, events: [] };
  const unit = getUnit(unitId);
  const validIds = new Set(unit.expressions.map((e) => e.id));
  st.turnsInStage++;

  // 복습 항목 통과 처리
  if (st.stage === "review") {
    for (const id of output.used_expressions) {
      const item = st.reviewItems.find((r) => r.expressionId === id && !r.result);
      if (item) {
        item.result = "pass";
        reviewResult(id, true);
        outcome.xpGained += 5;
        outcome.events.push("review-pass");
      }
    }
    // 판정 통과로도 복습 인정 (따라 말하기로 다시 연습한 경우)
    if (judgment?.pass) {
      const item = st.reviewItems.find((r) => !r.result && judgment.target.toLowerCase().includes(r.en.toLowerCase().slice(0, 10)));
      if (item) {
        item.result = "pass";
        reviewResult(item.expressionId, true);
        outcome.xpGained += 5;
        outcome.events.push("review-pass");
      }
    }
  }

  // 새 표현 소개 카운트
  if (st.stage === "intro" && output.new_expression && validIds.has(output.new_expression)) {
    st.introIndex = Math.min(unit.expressions.length, st.introIndex + 1);
  }

  // 따라 말하기 판정 → 콤보/XP
  if (judgment) {
    if (judgment.pass) {
      st.combo++;
      outcome.xpGained += 10 + Math.min(10, st.combo * 2);
      outcome.events.push("judgment-pass");
      if (st.stage === "practice") {
        // 통과한 문장이 어떤 목표 표현이었는지 추정
        for (const e of unit.expressions) {
          if (judgment.target.toLowerCase().includes(e.en.toLowerCase().replace(/[.?!]$/, "").slice(0, 12)) && !st.practicedIds.includes(e.id)) {
            st.practicedIds.push(e.id);
          }
        }
      }
    } else {
      st.combo = 0;
    }
  }

  // 학습자가 목표 표현을 직접 사용
  for (const id of output.used_expressions) {
    if (!validIds.has(id)) continue;
    outcome.xpGained += 5;
    outcome.events.push("expression-used");
    if (st.stage === "practice" && !st.practicedIds.includes(id)) st.practicedIds.push(id);
    if (st.stage === "roleplay" && !st.roleplayUsedIds.includes(id)) st.roleplayUsedIds.push(id);
  }

  // ── 단계 전환 판단 ──
  let advance = output.stage_signal === "advance";
  // LLM이 진행을 놓쳐도 멈추지 않게 하는 안전장치
  if (!advance && st.turnsInStage >= MAX_TURNS[st.stage]) advance = true;
  // 조건 미충족 시 조기 진행 방지
  if (advance) {
    if (st.stage === "intro" && st.introIndex < unit.expressions.length && st.turnsInStage < MAX_TURNS.intro) advance = false;
    if (st.stage === "practice" && st.practicedIds.length < 3 && st.turnsInStage < MAX_TURNS.practice) advance = false;
    if (st.stage === "roleplay" && st.roleplayUsedIds.length < 2 && st.turnsInStage < MAX_TURNS.roleplay) advance = false;
  }

  if (advance && st.stage !== "done") {
    const idx = STAGE_ORDER.indexOf(st.stage);
    st.stage = STAGE_ORDER[Math.min(idx + 1, STAGE_ORDER.length - 1)];
    st.turnsInStage = 0;
    outcome.events.push("stage-advance");
    if (st.stage === "done") {
      outcome.xpGained += 50;
      outcome.events.push("unit-clear");
    }
  }

  return outcome;
}
