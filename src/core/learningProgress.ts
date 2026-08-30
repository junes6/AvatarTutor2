import { getSession } from "./session";
import { listNames } from "./store";
import type { SessionRecord } from "./types";

export interface LearningProgressSummary {
  totalSessions: number;
  weeklySessions: number;
  speakingTurns: number;
  weeklySpeakingTurns: number;
  correctedSentences: number;
  practicedExpressions: number;
  averagePronunciation: number | null;
  pronunciationTrend: number | null;
  practiceMinutes: number;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SESSION_MS = 60 * 60 * 1000;

function learnerTurns(session: SessionRecord) {
  return session.turns.filter((turn) => turn.role === "user");
}

function sessionPracticeMs(session: SessionRecord): number {
  const turns = learnerTurns(session);
  if (turns.length === 0) return 0;
  if (Number.isFinite(session.elapsedSeconds) && Number(session.elapsedSeconds) > 0) {
    return Math.min(MAX_SESSION_MS, Math.round(Number(session.elapsedSeconds) * 1000));
  }
  const lastActivity = session.endedAt ?? session.turns.at(-1)?.ts ?? session.startedAt;
  return Math.min(MAX_SESSION_MS, Math.max(0, lastActivity - session.startedAt));
}

function roundedAverage(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function summarizeLearningProgress(
  sessions: readonly SessionRecord[],
  now = Date.now(),
): LearningProgressSummary {
  const practiced = sessions.filter((session) => learnerTurns(session).length > 0);
  const weekStart = now - WEEK_MS;
  const weeklyTurnsBySession = new Map(
    practiced.map((session) => [
      session.id,
      learnerTurns(session).filter((turn) => turn.ts >= weekStart),
    ]),
  );
  const weekly = practiced.filter((session) => (weeklyTurnsBySession.get(session.id)?.length ?? 0) > 0);
  const expressionIds = new Set<string>();
  const scores: Array<{ score: number; ts: number }> = [];

  for (const session of practiced) {
    session.stageState?.practicedIds.forEach((id) => expressionIds.add(id));
    session.stageState?.roleplayUsedIds.forEach((id) => expressionIds.add(id));
    const judgedTurns = learnerTurns(session).filter((turn) => Boolean(turn.judgment));
    if (judgedTurns.length > 0) {
      judgedTurns.forEach((turn) => scores.push({ score: turn.judgment!.score, ts: turn.ts }));
    } else {
      // Compatibility for older records that stored judgments only on the
      // session. Keep their original order without relying on object identity
      // after JSON serialization.
      session.judgments.forEach((judgment, index) => {
        scores.push({ score: judgment.score, ts: learnerTurns(session)[index]?.ts ?? session.startedAt + index });
      });
    }
  }

  scores.sort((a, b) => a.ts - b.ts);
  const recent = scores.slice(-5).map((item) => item.score);
  const previous = scores.slice(-10, -5).map((item) => item.score);
  const recentAverage = roundedAverage(recent);
  const previousAverage = roundedAverage(previous);

  return {
    totalSessions: practiced.length,
    weeklySessions: weekly.length,
    speakingTurns: practiced.reduce((sum, session) => sum + learnerTurns(session).length, 0),
    weeklySpeakingTurns: weekly.reduce(
      (sum, session) => sum + (weeklyTurnsBySession.get(session.id)?.length ?? 0),
      0,
    ),
    correctedSentences: practiced.reduce((sum, session) => sum + session.corrections.length, 0),
    practicedExpressions: expressionIds.size,
    averagePronunciation: roundedAverage(scores.map((item) => item.score)),
    pronunciationTrend:
      recentAverage !== null && previousAverage !== null ? recentAverage - previousAverage : null,
    practiceMinutes: Math.round(
      practiced.reduce((sum, session) => sum + sessionPracticeMs(session), 0) / 60_000,
    ),
  };
}

export function getLearningProgress(now = Date.now()): LearningProgressSummary {
  const sessions = listNames("sessions")
    .map((id) => getSession(id))
    .filter((session): session is SessionRecord => Boolean(session));
  return summarizeLearningProgress(sessions, now);
}
