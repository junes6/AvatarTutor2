// 세션 생명주기 — 생성 / 저장 / 종료(리포트·기억·SRS·로그 내보내기)

import fs from "fs";
import path from "path";
import { deleteJSON, listNames, readJSON, writeJSON, uid } from "./store";
import { initStageState } from "./learning/engine";
import { summarizeToMemory, turnsToTranscript } from "./memory";
import { getUser, saveUser, addIntimacy } from "./gamification";
import { enqueueExpressions } from "./srs";
import { getUnit } from "./content";
import { appendCallSummary } from "./chat";
import { recordCall } from "./friends";
import type { CallSummary, SessionRecord, Mode, PendingSessionTurn } from "./types";

/** 통화가 끝난 뒤 채팅방에 남길 요약 — 얼마나 말했고 무엇을 건졌는지만 담는다. */
export function buildCallSummary(session: SessionRecord): CallSummary {
  const learnerTurns = session.turns.filter((turn) => turn.role === "user");
  // 하이라이트는 튜터가 실제로 제안하거나 고쳐 준 표현에서만 뽑는다.
  const highlights = [
    ...session.corrections.map((correction) => correction.better),
    ...session.turns.map((turn) => turn.suggestion?.en).filter((value): value is string => Boolean(value)),
  ];
  return {
    sessionId: session.id,
    durationSec: session.elapsedSeconds ?? 0,
    turns: learnerTurns.length,
    highlights: [...new Set(highlights)].slice(0, 3),
    correctionCount: session.corrections.length,
    xpEarned: session.xpEarned,
  };
}

const sessionQueues = new Map<string, Promise<void>>();
const activeTurnControllers = new Map<string, AbortController>();

/** Serializes state-changing work for one session inside the current Node process. */
export async function withSessionLock<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
  const previous = sessionQueues.get(sessionId) ?? Promise.resolve();
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  sessionQueues.set(sessionId, tail);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (sessionQueues.get(sessionId) === tail) sessionQueues.delete(sessionId);
  }
}

export function registerActiveSessionTurn(sessionId: string, controller: AbortController) {
  activeTurnControllers.get(sessionId)?.abort(new Error("Superseded by a newer turn"));
  activeTurnControllers.set(sessionId, controller);
}

export function clearActiveSessionTurn(sessionId: string, controller: AbortController) {
  if (activeTurnControllers.get(sessionId) === controller) activeTurnControllers.delete(sessionId);
}

export function cancelActiveSessionTurn(sessionId: string) {
  activeTurnControllers.get(sessionId)?.abort(new Error("Session ended"));
}

function normalizedSeconds(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(86_400, Math.round(value))) : 0;
}

function nextLifecycleVersion(session: SessionRecord, requested?: number): number | null {
  const current = Number.isFinite(session.lifecycleVersion)
    ? Math.max(0, Math.round(session.lifecycleVersion ?? 0))
    : 0;
  if (typeof requested === "number") {
    const incoming = Math.max(0, Math.round(requested));
    return incoming <= current ? null : incoming;
  }
  return Math.max(current + 1, Date.now());
}

function applyPendingTurn(
  session: SessionRecord,
  pendingTurn: PendingSessionTurn | null | undefined,
) {
  if (pendingTurn === null) {
    session.pendingTurn = undefined;
    return;
  }
  if (!pendingTurn?.text) return;
  const alreadySaved = Boolean(
    pendingTurn.clientTurnId
    && session.turns.some((turn) =>
      turn.role === "user" && turn.clientTurnId === pendingTurn.clientTurnId),
  );
  session.pendingTurn = alreadySaved ? undefined : pendingTurn;
}

function sessionActivityAt(session: SessionRecord): number {
  return session.lastActiveAt
    ?? session.pausedAt
    ?? session.turns.at(-1)?.ts
    ?? session.startedAt;
}

function samePractice(
  session: SessionRecord,
  criteria: { tutorId: string; mode: Mode; scenarioId?: string; unitId?: string },
): boolean {
  return session.tutorId === criteria.tutorId
    && session.mode === criteria.mode
    && (session.scenarioId ?? "") === (criteria.scenarioId ?? "")
    && (session.unitId ?? "") === (criteria.unitId ?? "");
}

export function createSession(
  tutorId: string,
  mode: Mode,
  opts: { scenarioId?: string; unitId?: string } = {},
  persist = true,
): SessionRecord {
  const now = Date.now();
  const session: SessionRecord = {
    id: uid("s"),
    tutorId,
    mode,
    scenarioId: opts.scenarioId,
    unitId: opts.unitId,
    startedAt: now,
    lastActiveAt: now,
    elapsedSeconds: 0,
    resumeCount: 0,
    lifecycleVersion: now,
    turns: [],
    corrections: [],
    judgments: [],
    xpEarned: 0,
    pronunciationScores: [],
  };
  if (mode === "learning" && opts.unitId) {
    session.stageState = initStageState();
  }
  if (persist) saveSession(session);
  return session;
}

export function getSession(id: string): SessionRecord | null {
  return readJSON<SessionRecord | null>(`sessions/${id}`, null);
}

export function saveSession(session: SessionRecord) {
  writeJSON(`sessions/${session.id}`, session);
}

export interface ResumableSessionSummary {
  sessionId: string;
  tutorId: string;
  mode: Mode;
  scenarioId?: string;
  unitId?: string;
  startedAt: number;
  lastActiveAt: number;
  pausedAt?: number;
  elapsedSeconds: number;
  resumeCount: number;
  userTurnCount: number;
  totalTurnCount: number;
  hasPendingTurn: boolean;
  stageState: SessionRecord["stageState"] | null;
  learnedExpressionIds: string[];
}

export function learnedExpressionIds(session: SessionRecord): string[] {
  if (session.mode !== "learning" || !session.stageState || !session.unitId) return [];
  let introduced: string[] = [];
  try {
    introduced = getUnit(session.unitId).expressions
      .slice(0, session.stageState.introIndex)
      .map((expression) => expression.id);
  } catch {
    // A removed curriculum item must not make every other resumable session
    // disappear from the home screen.
  }
  return [...new Set([
    ...session.stageState.reviewItems.filter((item) => Boolean(item.result)).map((item) => item.expressionId),
    ...introduced,
    ...session.stageState.practicedIds,
    ...session.stageState.roleplayUsedIds,
  ])];
}

export function resumableSessionSummary(session: SessionRecord): ResumableSessionSummary {
  return {
    sessionId: session.id,
    tutorId: session.tutorId,
    mode: session.mode,
    scenarioId: session.scenarioId,
    unitId: session.unitId,
    startedAt: session.startedAt,
    lastActiveAt: sessionActivityAt(session),
    pausedAt: session.pausedAt,
    elapsedSeconds: normalizedSeconds(session.elapsedSeconds ?? 0),
    resumeCount: Math.max(0, Math.round(session.resumeCount ?? 0)),
    userTurnCount: session.turns.filter((turn) => turn.role === "user").length,
    totalTurnCount: session.turns.length,
    hasPendingTurn: Boolean(session.pendingTurn?.text),
    stageState: session.stageState ?? null,
    learnedExpressionIds: learnedExpressionIds(session),
  };
}

/** Latest unfinished session for each distinct practice, newest first. */
export function getResumableSessions(limit = 8): ResumableSessionSummary[] {
  const latestByPractice = new Map<string, SessionRecord>();
  for (const name of listNames("sessions")) {
    const session = getSession(name);
    // A session is worth resuming only after the learner has actually spoken.
    // Greeting-only records are created before the briefing is accepted and
    // would otherwise replace the real "continue" card with an empty call.
    if (
      !session
      || session.endedAt
      || (!session.pendingTurn?.text && !session.turns.some((turn) => turn.role === "user"))
    ) continue;
    const key = [session.tutorId, session.mode, session.scenarioId ?? "", session.unitId ?? ""].join(":");
    const current = latestByPractice.get(key);
    if (!current || sessionActivityAt(session) > sessionActivityAt(current)) latestByPractice.set(key, session);
  }
  return [...latestByPractice.values()]
    .sort((a, b) => sessionActivityAt(b) - sessionActivityAt(a))
    .slice(0, Math.max(0, Math.min(20, Math.round(limit))))
    .map(resumableSessionSummary);
}

export function findResumableSession(criteria: {
  tutorId: string;
  mode: Mode;
  scenarioId?: string;
  unitId?: string;
}): SessionRecord | null {
  const summary = getResumableSessions(20).find((candidate) =>
    candidate.tutorId === criteria.tutorId
      && candidate.mode === criteria.mode
      && (candidate.scenarioId ?? "") === (criteria.scenarioId ?? "")
      && (candidate.unitId ?? "") === (criteria.unitId ?? ""),
  );
  if (!summary) return null;
  const session = getSession(summary.sessionId);
  return session && !session.endedAt && samePractice(session, criteria) ? session : null;
}

/** Parks a session without awarding completion rewards or producing a report. */
export async function pauseSession(
  id: string,
  elapsedSeconds: number,
  pendingTurn?: PendingSessionTurn | null,
  lifecycleVersion?: number,
): Promise<SessionRecord | null> {
  return withSessionLock(id, async () => {
    const session = getSession(id);
    if (!session || session.endedAt) return null;
    const nextVersion = nextLifecycleVersion(session, lifecycleVersion);
    if (nextVersion === null) return session;
    cancelActiveSessionTurn(id);
    const now = Date.now();
    session.elapsedSeconds = Math.max(
      normalizedSeconds(session.elapsedSeconds ?? 0),
      normalizedSeconds(elapsedSeconds),
    );
    session.pausedAt = now;
    session.lastActiveAt = now;
    session.lifecycleVersion = nextVersion;
    applyPendingTurn(session, pendingTurn);
    saveSession(session);
    return session;
  });
}

/** Saves active speaking time without changing whether the call is live. */
export async function checkpointSession(
  id: string,
  elapsedSeconds: number,
  pendingTurn?: PendingSessionTurn | null,
  lifecycleVersion?: number,
): Promise<SessionRecord | null> {
  return withSessionLock(id, async () => {
    const session = getSession(id);
    if (!session || session.endedAt) return null;
    const nextVersion = nextLifecycleVersion(session, lifecycleVersion);
    if (nextVersion === null) return session;
    session.elapsedSeconds = Math.max(
      normalizedSeconds(session.elapsedSeconds ?? 0),
      normalizedSeconds(elapsedSeconds),
    );
    session.lastActiveAt = Date.now();
    session.lifecycleVersion = nextVersion;
    applyPendingTurn(session, pendingTurn);
    saveSession(session);
    return session;
  });
}

/** Restores the same record; turns, stage progress and learned expressions remain intact. */
export async function resumeSession(id: string, lifecycleVersion?: number): Promise<SessionRecord | null> {
  return withSessionLock(id, async () => {
    const session = getSession(id);
    if (!session || session.endedAt) return null;
    const nextVersion = nextLifecycleVersion(session, lifecycleVersion);
    if (nextVersion === null) return session;
    const wasPaused = Boolean(session.pausedAt);
    session.pausedAt = undefined;
    session.lastActiveAt = Date.now();
    session.lifecycleVersion = nextVersion;
    if (wasPaused) session.resumeCount = Math.max(0, Math.round(session.resumeCount ?? 0)) + 1;
    saveSession(session);
    return session;
  });
}

/** Removes only a session that never received a learner turn. */
export async function discardUnstartedSession(id: string): Promise<boolean> {
  cancelActiveSessionTurn(id);
  return withSessionLock(id, async () => {
    const session = getSession(id);
    if (
      !session
      || session.endedAt
      || Boolean(session.pendingTurn?.text)
      || session.turns.some((turn) => turn.role === "user")
    ) return false;
    return deleteJSON(`sessions/${id}`);
  });
}

export interface EndSessionResult {
  session: SessionRecord;
  endedNow: boolean;
}

export async function endSession(id: string, callSeconds: number): Promise<EndSessionResult | null> {
  return withSessionLock(id, async () => {
    const session = getSession(id);
    if (!session) return null;
    if (session.endedAt) return { session, endedNow: false }; // 이미 종료됨

    session.endedAt = Date.now();
    session.lastActiveAt = session.endedAt;
    session.pausedAt = undefined;
    session.elapsedSeconds = Math.max(
      normalizedSeconds(session.elapsedSeconds ?? 0),
      normalizedSeconds(callSeconds),
    );
    saveSession(session);

    const hasLearnerTurn = session.turns.some((turn) => turn.role === "user");

  // 오늘의 목표: 통화 시간
    const user = getUser();
    if (hasLearnerTurn) {
      user.dailyGoal.callSeconds += session.elapsedSeconds;
    }

  // 유닛 완료 처리
    if (hasLearnerTurn && session.mode === "learning" && session.unitId && session.stageState?.stage === "done") {
      if (!user.completedUnits.includes(session.unitId)) {
        user.completedUnits.push(session.unitId);
      }
      const unit = getUnit(session.unitId);
      enqueueExpressions(session.unitId, unit.expressions.map((e) => e.id));
    }
    saveUser(user);
    if (hasLearnerTurn) addIntimacy(session.tutorId, 5); // 실제 참여한 세션만 완료 보너스

    // 통화가 끝나면 대화 내용이 채팅방에 요약 카드로 남는다.
    if (hasLearnerTurn) {
      try {
        recordCall(session.tutorId, session.elapsedSeconds ?? 0);
        appendCallSummary(session.tutorId, buildCallSummary(session));
      } catch (error) {
        // 요약 카드는 부가 기능이다 — 실패해도 세션 종료 자체를 막지 않는다.
        console.error("[session] call summary failed:", error);
      }
    }

    // 전체 로그를 logs/ 로 내보내기 (외부 검증용)
    exportSessionLog(session);

    return { session, endedNow: true };
  });
}

export async function summarizeEndedSession(session: SessionRecord) {
  try {
    await summarizeToMemory(session.tutorId, turnsToTranscript(session.turns));
  } catch (e) {
    console.error("[session] memory summarize failed:", e);
  }
}

export function exportSessionLog(session: SessionRecord) {
  try {
    const dir = process.env.SESSION_LOG_DIR
      ? path.resolve(process.env.SESSION_LOG_DIR)
      : path.join(process.cwd(), "logs");
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
