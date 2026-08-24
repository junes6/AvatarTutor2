// 세션 시작/종료 API

import { NextResponse } from "next/server";
import { createSession, endSession, getSession, saveSession } from "@/core/session";
import { greetTurn } from "@/core/pipeline/turn";
import { synthesize } from "@/core/tts";
import { getPersona, findExpression } from "@/core/content";
import { getUser } from "@/core/gamification";
import type { Mode } from "@/core/types";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (body.action === "start") {
      const { tutorId, mode, scenarioId, unitId } = body as {
        tutorId: string;
        mode: Mode;
        scenarioId?: string;
        unitId?: string;
      };
      const session = createSession(tutorId, mode, { scenarioId, unitId });
      const greeting = await greetTurn(session);
      saveSession(session);

      const persona = getPersona(tutorId);
      const user = getUser();
      const audio = await synthesize(greeting.reply, persona.voice, {
        speed: user.settings.speechRate,
        feature: "greeting",
      });

      return NextResponse.json({
        sessionId: session.id,
        stageState: session.stageState ?? null,
        greeting: { ...greeting, audio },
        expressionCard: greeting.new_expression ? findExpression(greeting.new_expression)?.expr ?? null : null,
      });
    }

    if (body.action === "end") {
      const { sessionId, callSeconds } = body as { sessionId: string; callSeconds?: number };
      const session = await endSession(sessionId, callSeconds ?? 0);
      if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
      return NextResponse.json({ ok: true, sessionId: session.id });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    console.error("[api/session]", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ session });
}
