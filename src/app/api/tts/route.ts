// 임의 문장 TTS — 표현 카드 듣기, 다시듣기(0.7배속은 클라이언트 playbackRate로)

import { NextResponse } from "next/server";
import { synthesize } from "@/core/tts";
import { getPersona } from "@/core/content";

export async function POST(req: Request) {
  try {
    const { text, tutorId, speed } = (await req.json()) as { text: string; tutorId: string; speed?: number };
    if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });
    const persona = getPersona(tutorId);
    const audio = await synthesize(text, persona.voice, { speed: speed ?? 1.0, feature: "tts" });
    return NextResponse.json({ audio }); // null이면 클라이언트가 speechSynthesis 폴백
  } catch (e) {
    console.error("[api/tts]", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
