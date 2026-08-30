import type { SessionRecord } from "@/core/types";

interface ExpressionIdentity {
  id: string;
}

export function isReportSessionComplete(session: SessionRecord): boolean {
  const userTurns = session.turns.filter((turn) => turn.role === "user").length;
  return session.mode === "learning" ? session.stageState?.stage === "done" : userTurns > 0;
}

export function getReportExpressions<T extends ExpressionIdentity>(
  session: SessionRecord,
  expressions: T[],
  unitExpressions: T[] = expressions,
): T[] {
  if (session.mode === "learning" && session.stageState?.stage === "done") return expressions;

  const practicedIds = new Set([
    ...(session.stageState?.reviewItems.filter((item) => Boolean(item.result)).map((item) => item.expressionId) ?? []),
    ...unitExpressions.slice(0, session.stageState?.introIndex ?? 0).map((expression) => expression.id),
    ...(session.stageState?.practicedIds ?? []),
    ...(session.stageState?.roleplayUsedIds ?? []),
  ]);
  return expressions.filter((expression) => practicedIds.has(expression.id));
}

export function getReportDurationLabel(session: SessionRecord): string {
  const wallClockSeconds = session.endedAt ? Math.max(0, Math.round((session.endedAt - session.startedAt) / 1000)) : 0;
  // Resumable sessions may sit paused for hours or days. Prefer persisted active
  // practice time so that the report never counts time away from the lesson.
  const seconds = session.endedAt && typeof session.elapsedSeconds === "number"
    ? Math.max(0, Math.round(session.elapsedSeconds))
    : wallClockSeconds;
  return seconds < 60 ? `${seconds}초` : `${Math.max(1, Math.round(seconds / 60))}분`;
}
