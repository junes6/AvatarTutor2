// 대화 턴 처리기 — STT 이후의 모든 것: 프롬프트 조립 → LLM → 파싱 → 학습 엔진 반영.
// UI 없이도 실행 가능 (scripts/simulate.ts 에서 그대로 사용).

import { chatLLM, type LLMMessage } from "../llm";
import { buildSystemPrompt } from "./systemPrompt";
import { sanitizeTurnOutput } from "./parse";
import { applyTurn, type StageOutcome } from "../learning/engine";
import { addXp, addIntimacy, getUser, saveUser } from "../gamification";
import { uid } from "../store";
import type { SessionRecord, TurnResult, Judgment, TurnLog } from "../types";

const HISTORY_LIMIT = 24;

export interface RunTurnInput {
  session: SessionRecord; // 직접 수정됨 — 호출자가 저장 책임
  userText: string;
  judgment?: Judgment; // 따라 말하기 턴이면 라우트에서 계산해 전달
  isGreeting?: boolean; // 통화 연결 직후 튜터 첫 인사 (userText는 기록되지 않음)
}

export async function runTurn(input: RunTurnInput): Promise<TurnResult & { events: string[] }> {
  const { session } = input;
  const system = buildSystemPrompt(session, input.judgment);

  const history: LLMMessage[] = session.turns
    .slice(-HISTORY_LIMIT)
    .map((t) => ({ role: t.role === "user" ? ("user" as const) : ("assistant" as const), content: t.text }));

  history.push({ role: "user", content: input.userText });

  const llm = await chatLLM({
    system,
    messages: history,
    maxTokens: 1024,
    feature: session.mode === "learning" ? "learning-turn" : session.mode === "chat" ? "chat-turn" : "freetalk-turn",
  });

  const output = sanitizeTurnOutput(llm.text);

  // ── 학습 엔진 반영 ──
  let outcome: StageOutcome = { xpGained: 0, events: [] };
  if (session.mode === "learning" && session.unitId && session.stageState) {
    outcome = applyTurn(session.stageState, session.unitId, output, input.judgment);
  }

  // ── 세션 기록 ──
  if (!input.isGreeting) {
    const userLog: TurnLog = {
      id: uid("t"),
      role: "user",
      text: input.userText,
      ts: Date.now(),
      judgment: input.judgment,
    };
    session.turns.push(userLog);
  }
  const tutorLog: TurnLog = {
    id: uid("t"),
    role: "tutor",
    text: output.reply,
    ko: output.reply_ko,
    ts: Date.now(),
    correction: output.correction,
    suggestion: output.suggestion,
    usage: llm.usage,
  };
  session.turns.push(tutorLog);

  if (output.correction) session.corrections.push(output.correction);
  if (input.judgment) {
    session.judgments.push(input.judgment);
    session.pronunciationScores.push(input.judgment.score);
  }

  // ── XP / 친밀도 / 오늘의 목표 ──
  let xp = outcome.xpGained;
  if (!input.isGreeting) xp += 2; // 발화 자체에 소량 XP
  session.xpEarned += xp;
  if (xp > 0) addXp(xp);
  if (!input.isGreeting) addIntimacy(session.tutorId, outcome.events.includes("unit-clear") ? 11 : 1);

  const reviewPasses = outcome.events.filter((e) => e === "review-pass").length;
  if (reviewPasses > 0 || outcome.events.includes("unit-clear")) {
    const u = getUser();
    u.dailyGoal.reviewsDone += reviewPasses;
    if (outcome.events.includes("unit-clear")) u.dailyGoal.unitDone = true;
    saveUser(u);
  }

  return { ...output, usage: llm.usage, judgment: input.judgment, events: outcome.events };
}

/** 통화 연결 직후 튜터의 첫 인사 */
export async function greetTurn(session: SessionRecord): Promise<TurnResult & { events: string[] }> {
  return runTurn({
    session,
    userText:
      "(시스템: 방금 영상통화가 연결되었습니다. 학습자는 아직 아무 말도 하지 않았습니다. 페르소나와 현재 모드에 맞는 첫 인사로 대화를 시작해 주세요.)",
    isGreeting: true,
  });
}
