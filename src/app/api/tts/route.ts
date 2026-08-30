// 임의 문장 TTS — 표현 카드 듣기, 다시듣기(0.7배속은 클라이언트 playbackRate로)

import { NextResponse } from "next/server";
import { synthesize } from "@/core/tts";
import { getPersona } from "@/core/content";
import { getUser } from "@/core/gamification";
import { effectiveSpeechRate } from "@/core/levelAdaptation";

const MAX_JSON_BYTES = 16 * 1024;

export async function POST(req: Request) {
  try {
    const contentLength = Number(req.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BYTES) {
      return NextResponse.json({ error: "request too large" }, { status: 413 });
    }
    const parsed = await req.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return NextResponse.json({ error: "invalid request" }, { status: 400 });
    }
    const body = parsed as { text?: unknown; tutorId?: unknown; speed?: unknown };
    const text = typeof body.text === "string" ? body.text.replace(/\s+/g, " ").trim() : "";
    const tutorId = typeof body.tutorId === "string" ? body.tutorId.trim() : "";
    if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });
    if (!tutorId) return NextResponse.json({ error: "tutorId required" }, { status: 400 });
    if (text.length > 4_000) return NextResponse.json({ error: "text too long" }, { status: 413 });

    let persona;
    try {
      persona = getPersona(tutorId);
    } catch {
      return NextResponse.json({ error: "unknown tutor" }, { status: 404 });
    }
    const parsedSpeed = typeof body.speed === "number" && Number.isFinite(body.speed) ? body.speed : 1;
    const requestModifier = Math.min(1.5, Math.max(0.5, parsedSpeed));
    const user = getUser();
    const adaptiveRate = effectiveSpeechRate(user.level, user.settings.speechRate);
    const speed = Math.min(2, Math.max(0.5, adaptiveRate * requestModifier));
    const audio = await synthesize(text, persona.voice, { speed, feature: "tts", signal: req.signal });
    return NextResponse.json(
      { audio, fallbackTutorId: persona.id, fallbackRate: adaptiveRate },
      { headers: { "Cache-Control": "private, no-store" } },
    ); // null이면 클라이언트가 해당 tutorId의 speechSynthesis profile로 폴백
  } catch (e) {
    if (e instanceof SyntaxError) return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    console.error("[api/tts]", e);
    return NextResponse.json({ error: "tts request failed" }, { status: 500 });
  }
}
