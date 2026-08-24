// 세션 생명주기 — 생성 / 저장 / 종료(리포트·기억·SRS·로그 내보내기)

import fs from "fs";
import path from "path";
import { readJSON, writeJSON, uid } from "./store";
import { initStageState } from "./learning/engine";
import { summarizeToMemory, turnsToTranscript } from "./memory";
import { getUser, saveUser, addIntimacy } from "./gamification";
import { enqueueExpressions } from "./srs";
import { getUnit } from "./content";
import type { SessionRecord, Mode } from "./types";

export function createSession(
  tutorId: string,
  mode: Mode,
  opts: { scenarioId?: string; unitId?: string } = {},
): SessionRecord {
  const session: SessionRecord = {
    id: uid("s"),
    tutorId,
    mode,
    scenarioId: opts.scenarioId,
    unitId: opts.unitId,
    startedAt: Date.now(),
    turns: [],
    corrections: [],
    judgments: [],
    xpEarned: 0,
    pronunciationScores: [],
  };
  if (mode === "learning" && opts.unitId) {
    session.stageState = initStageState();
  }
  saveSession(session);
  return session;
}

export function getSession(id: string): SessionRecord | null {
  return readJSON<SessionRecord | null>(`sessions/${id}`, null);
}

export function saveSession(session: SessionRecord) {
  writeJSON(`sessions/${session.id}`, session);
}

export async function endSession(id: string, callSeconds: number): Promise<SessionRecord | null> {
  const session = getSession(id);
  if (!session) return null;
  if (session.endedAt) return session; // 이미 종료됨

  session.endedAt = Date.now();
  saveSession(session);

  // 오늘의 목표: 통화 시간
  const user = getUser();
  user.dailyGoal.callSeconds += callSeconds;

  // 유닛 완료 처리
  if (session.mode === "learning" && session.unitId && session.stageState?.stage === "done") {
    if (!user.completedUnits.includes(session.unitId)) {
      user.completedUnits.push(session.unitId);
    }
    const unit = getUnit(session.unitId);
    enqueueExpressions(session.unitId, unit.expressions.map((e) => e.id));
  }
  saveUser(user);
  addIntimacy(session.tutorId, 5); // 세션 완료 보너스

  // 전체 로그를 logs/ 로 내보내기 (외부 검증용)
  exportSessionLog(session);

  // 장기기억 요약 (실패해도 세션 종료는 성공)
  try {
    await summarizeToMemory(session.tutorId, turnsToTranscript(session.turns));
  } catch (e) {
    console.error("[session] memory summarize failed:", e);
  }

  return session;
}

export function exportSessionLog(session: SessionRecord) {
  try {
    const dir = path.join(process.cwd(), "logs");
    fs.mkdirSync(dir, { recursive: true });
    const totalUsage = session.turns.reduce(
      (acc, t) => ({
        inputTokens: acc.inputTokens + (t.usage?.inputTokens ?? 0),
        outputTokens: acc.outputTokens + (t.usage?.outputTokens ?? 0),
      }),
      { inputTokens: 0, outputTokens: 0 },
    );
    const payload = { ...session, totalUsage, exportedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(dir, `session-${session.id}.json`), JSON.stringify(payload, null, 2), "utf8");
  } catch (e) {
    console.error("[session] log export failed:", e);
  }
}
