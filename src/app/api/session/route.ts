// 세션 시작/종료 API

import { after, NextResponse } from "next/server";
import {
  cancelActiveSessionTurn,
  checkpointSession,
  createSession,
  discardUnstartedSession,
  endSession,
  findResumableSession,
  getSession,
  getResumableSessions,
  learnedExpressionIds,
  pauseSession,
  resumeSession,
  saveSession,
  summarizeEndedSession,
} from "@/core/session";
import { greetTurn } from "@/core/pipeline/turn";
import { getPersona, getScenario, getUnit, findExpression } from "@/core/content";
import type { Mode, PendingSessionTurn, SessionRecord } from "@/core/types";

const MAX_JSON_BYTES = 16 * 1024;

function validSessionId(value: unknown): value is string {
  return typeof value === "string" && value.length <= 80 && /^s[a-z0-9]+$/i.test(value);
}

function validElapsedSeconds(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 86_400;
}

function validLifecycleVersion(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value > 0;
}

function parsePendingTurn(value: unknown): PendingSessionTurn | undefined | null {
  if (typeof value === "undefined") return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const draft = value as Record<string, unknown>;
  const text = typeof draft.text === "string" ? draft.text.trim() : "";
  const clientTurnId = typeof draft.clientTurnId === "string" ? draft.clientTurnId.trim() : "";
  const repeatTarget = typeof draft.repeatTarget === "string" ? draft.repeatTarget.trim() : "";
  if (
    !text
    || text.length > 2_000
    || repeatTarget.length > 500
    || clientTurnId.length > 80
    || (clientTurnId && !/^[A-Za-z0-9_-]+$/.test(clientTurnId))
  ) return null;
  if (draft.inputLanguage !== "en-US" && draft.inputLanguage !== "ko-KR") return null;
  return {
    text,
    inputLanguage: draft.inputLanguage,
    clientTurnId: clientTurnId || undefined,
    repeatTarget: repeatTarget || undefined,
    savedAt: typeof draft.savedAt === "number" && Number.isFinite(draft.savedAt)
      ? Math.max(0, Math.round(draft.savedAt))
      : Date.now(),
  };
}

function resumeExpressionCard(session: SessionRecord) {
  if (!session.unitId || !session.stageState) return null;
  try {
    const unit = getUnit(session.unitId);
    if (session.stageState.stage === "intro" && session.stageState.introIndex > 0) {
      return unit.expressions[Math.min(unit.expressions.length - 1, session.stageState.introIndex - 1)] ?? null;
    }
    if (session.stageState.stage === "practice") {
      return unit.expressions.find((expression) => !session.stageState?.practicedIds.includes(expression.id))
        ?? unit.expressions.at(-1)
        ?? null;
    }
  } catch {}
  return null;
}

function resumedSessionPayload(session: SessionRecord) {
  const lastTutorTurn = [...session.turns].reverse().find((turn) => turn.role === "tutor") ?? null;
  const continuation = lastTutorTurn ?? {
    text: "Welcome back. Let's continue from where we left off.",
    ko: "다시 오셨네요. 멈춘 곳부터 계속해 봐요.",
    correction: null,
    suggestion: null,
  };
  return {
    resumed: true,
    sessionId: session.id,
    stageState: session.stageState ?? null,
    turns: session.turns,
    elapsedSeconds: session.elapsedSeconds ?? 0,
    resumeCount: session.resumeCount ?? 0,
    lifecycleVersion: session.lifecycleVersion ?? 0,
    xpEarned: session.xpEarned ?? 0,
    pendingTurn: session.pendingTurn ?? null,
    learnedExpressionIds: learnedExpressionIds(session),
    lastTutorTurn,
    // Keep the existing call-page start contract usable while the UI migrates
    // to full transcript hydration.
    greeting: {
      reply: continuation.text,
      reply_ko: continuation.ko ?? "",
      correction: continuation.correction ?? null,
      suggestion: continuation.suggestion ?? null,
      new_expression: null,
      used_expressions: [],
      stage_signal: "stay" as const,
      end_call: false,
      audio: null,
    },
    expressionCard: resumeExpressionCard(session),
  };
}

export async function POST(req: Request) {
  try {
    const contentLength = Number(req.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BYTES) {
      return NextResponse.json({ error: "request too large" }, { status: 413 });
    }
    const body = await req.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: "invalid request" }, { status: 400 });
    }

    if (body.action === "start") {
      const { tutorId, mode, scenarioId, unitId } = body as {
        tutorId: string;
        mode: Mode;
        scenarioId?: string;
        unitId?: string;
      };
      if (typeof tutorId !== "string" || !tutorId) {
        return NextResponse.json({ error: "tutorId is required" }, { status: 400 });
      }
      if (mode !== "freetalk" && mode !== "learning") {
        return NextResponse.json({ error: "invalid mode" }, { status: 400 });
      }
      if (scenarioId && unitId) {
        return NextResponse.json({ error: "scenarioId and unitId cannot be combined" }, { status: 400 });
      }
      if (typeof scenarioId !== "undefined" && typeof scenarioId !== "string") {
        return NextResponse.json({ error: "invalid scenarioId" }, { status: 400 });
      }
      if (typeof unitId !== "undefined" && typeof unitId !== "string") {
        return NextResponse.json({ error: "invalid unitId" }, { status: 400 });
      }

      try {
        getPersona(tutorId);
        if (scenarioId && !getScenario(scenarioId)) throw new Error("unknown scenario");
        if (mode === "learning") {
          if (!unitId) throw new Error("unitId is required for learning mode");
          getUnit(unitId);
        } else if (unitId) {
          throw new Error("unitId requires learning mode");
        }
      } catch {
        return NextResponse.json({ error: "invalid session content" }, { status: 400 });
      }

      if ("resumeSessionId" in body && body.resumeSessionId !== undefined) {
        if (!validSessionId(body.resumeSessionId)) {
          return NextResponse.json({ error: "invalid resumeSessionId" }, { status: 400 });
        }
        const candidate = getSession(body.resumeSessionId);
        if (!candidate
          || candidate.endedAt
          || candidate.tutorId !== tutorId
          || candidate.mode !== mode
          || (candidate.scenarioId ?? "") !== (scenarioId ?? "")
          || (candidate.unitId ?? "") !== (unitId ?? "")) {
          return NextResponse.json({ error: "resumable session does not match this practice" }, { status: 409 });
        }
        const resumed = await resumeSession(candidate.id);
        if (!resumed) return NextResponse.json({ error: "session is no longer resumable" }, { status: 409 });
        return NextResponse.json(resumedSessionPayload(resumed));
      }

      if (body.resumeExisting === true) {
        const candidate = findResumableSession({ tutorId, mode, scenarioId, unitId });
        if (candidate) {
          const resumed = await resumeSession(candidate.id);
          if (resumed) return NextResponse.json(resumedSessionPayload(resumed));
        }
      } else if (body.resumeExisting !== undefined && body.resumeExisting !== false) {
        return NextResponse.json({ error: "invalid resumeExisting" }, { status: 400 });
      }

      // Persist only after the greeting is ready. Cancelling the ringing screen
      // aborts this request, so an unfinished call cannot leave an empty session.
      const session = createSession(tutorId, mode, { scenarioId, unitId }, false);
      const greeting = await greetTurn(session, req.signal);
      if (req.signal.aborted) {
        return NextResponse.json({ error: "session start cancelled" }, { status: 499 });
      }
      saveSession(session);

      return NextResponse.json({
        resumed: false,
        sessionId: session.id,
        lifecycleVersion: session.lifecycleVersion ?? 0,
        stageState: session.stageState ?? null,
        greeting: { ...greeting, audio: null },
        expressionCard: greeting.new_expression ? findExpression(greeting.new_expression)?.expr ?? null : null,
      });
    }

    if (body.action === "resume") {
      const sessionId = body.sessionId;
      if (!validSessionId(sessionId)) return NextResponse.json({ error: "invalid sessionId" }, { status: 400 });
      const lifecycleVersion = body.lifecycleVersion;
      if (lifecycleVersion !== undefined && !validLifecycleVersion(lifecycleVersion)) {
        return NextResponse.json({ error: "invalid lifecycleVersion" }, { status: 400 });
      }
      const resumed = await resumeSession(sessionId, lifecycleVersion);
      if (!resumed) return NextResponse.json({ error: "session is no longer resumable" }, { status: 409 });
      return NextResponse.json(resumedSessionPayload(resumed));
    }

    if (body.action === "pause") {
      const sessionId = body.sessionId;
      const elapsedSeconds = body.elapsedSeconds ?? body.callSeconds ?? 0;
      if (!validSessionId(sessionId)) return NextResponse.json({ error: "invalid sessionId" }, { status: 400 });
      if (!validElapsedSeconds(elapsedSeconds)) {
        return NextResponse.json({ error: "invalid elapsedSeconds" }, { status: 400 });
      }
      const lifecycleVersion = body.lifecycleVersion;
      if (lifecycleVersion !== undefined && !validLifecycleVersion(lifecycleVersion)) {
        return NextResponse.json({ error: "invalid lifecycleVersion" }, { status: 400 });
      }
      const clearPendingTurn = body.pendingTurn === null;
      const pendingTurn = clearPendingTurn ? null : parsePendingTurn(body.pendingTurn);
      if (!clearPendingTurn && pendingTurn === null) return NextResponse.json({ error: "invalid pendingTurn" }, { status: 400 });
      const paused = await pauseSession(sessionId, elapsedSeconds, pendingTurn, lifecycleVersion);
      if (!paused) return NextResponse.json({ error: "session is no longer resumable" }, { status: 409 });
      return NextResponse.json({
        ok: true,
        sessionId: paused.id,
        pausedAt: paused.pausedAt,
        elapsedSeconds: paused.elapsedSeconds ?? 0,
      });
    }

    if (body.action === "checkpoint") {
      const sessionId = body.sessionId;
      const elapsedSeconds = body.elapsedSeconds ?? 0;
      if (!validSessionId(sessionId)) return NextResponse.json({ error: "invalid sessionId" }, { status: 400 });
      if (!validElapsedSeconds(elapsedSeconds)) {
        return NextResponse.json({ error: "invalid elapsedSeconds" }, { status: 400 });
      }
      const lifecycleVersion = body.lifecycleVersion;
      if (lifecycleVersion !== undefined && !validLifecycleVersion(lifecycleVersion)) {
        return NextResponse.json({ error: "invalid lifecycleVersion" }, { status: 400 });
      }
      const clearPendingTurn = body.pendingTurn === null;
      const pendingTurn = clearPendingTurn ? null : parsePendingTurn(body.pendingTurn);
      if (!clearPendingTurn && pendingTurn === null) return NextResponse.json({ error: "invalid pendingTurn" }, { status: 400 });
      const checkpointed = await checkpointSession(sessionId, elapsedSeconds, pendingTurn, lifecycleVersion);
      if (!checkpointed) return NextResponse.json({ error: "session is no longer active" }, { status: 409 });
      return NextResponse.json({
        ok: true,
        sessionId: checkpointed.id,
        elapsedSeconds: checkpointed.elapsedSeconds ?? 0,
      });
    }

    if (body.action === "end") {
      const { sessionId, callSeconds } = body as { sessionId: string; callSeconds?: number };
      if (!validSessionId(sessionId)) {
        return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
      }
      cancelActiveSessionTurn(sessionId);
      const ended = await endSession(sessionId, Number.isFinite(callSeconds) ? callSeconds ?? 0 : 0);
      if (!ended) return NextResponse.json({ error: "session not found" }, { status: 404 });
      if (ended.endedNow) after(() => summarizeEndedSession(ended.session));
      return NextResponse.json({ ok: true, sessionId: ended.session.id });
    }

    if (body.action === "discard") {
      const sessionId = body.sessionId;
      if (!validSessionId(sessionId)) return NextResponse.json({ error: "invalid sessionId" }, { status: 400 });
      const discarded = await discardUnstartedSession(sessionId);
      return NextResponse.json({ ok: true, discarded });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    if (req.signal.aborted) {
      return NextResponse.json({ error: "session start cancelled" }, { status: 499 });
    }
    if (e instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    console.error("[api/session]", e);
    return NextResponse.json({ error: "session request failed" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  if (params.get("resumable") === "1") {
    return NextResponse.json(
      { resumableSessions: getResumableSessions() },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const id = params.get("id");
  if (!validSessionId(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(
    { session },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
