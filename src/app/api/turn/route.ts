// 대화 턴 API — 푸시투토크 오디오(또는 텍스트) → STT → 파이프라인 → TTS

import { NextResponse } from "next/server";
import { getSession, saveSession } from "@/core/session";
import { runTurn } from "@/core/pipeline/turn";
import { transcribe } from "@/core/stt";
import { synthesize } from "@/core/tts";
import { assessPronunciation } from "@/core/pronunciation";
import { getPersona, findExpression } from "@/core/content";
import { getUser, xpLevel } from "@/core/gamification";
import type { Judgment } from "@/core/types";

export async function POST(req: Request) {
  try {
    let sessionId = "";
    let userText = "";
    let repeatTarget = "";
    let audioBuf: Buffer | null = null;
    let mime = "";
    let durationSec = 0;

    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      sessionId = String(form.get("sessionId") ?? "");
      repeatTarget = String(form.get("repeatTarget") ?? "");
      durationSec = Number(form.get("durationSec") ?? 0);
      const audio = form.get("audio");
      if (audio instanceof Blob) {
        audioBuf = Buffer.from(await audio.arrayBuffer());
        mime = audio.type || "audio/webm";
      }
      userText = String(form.get("text") ?? "");
    } else {
      const body = await req.json();
      sessionId = body.sessionId;
      userText = body.text ?? "";
      repeatTarget = body.repeatTarget ?? "";
    }

    const session = getSession(sessionId);
    if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });

    // 1) STT — 완성 발화만 전송되므로 스트리밍 불필요
    if (!userText && audioBuf) {
      const stt = await transcribe(audioBuf, mime, { feature: "turn", durationSec });
      userText = stt.text;
    }
    if (!userText.trim()) {
      return NextResponse.json({ empty: true, message: "발화가 인식되지 않았어요. 다시 말해볼까요?" });
    }

    // 2) 따라 말하기 판정 (발음 평가 → 폴백: 유사도)
    let judgment: Judgment | undefined;
    if (repeatTarget) {
      judgment = await assessPronunciation(repeatTarget, userText, audioBuf, mime);
    }

    // 3) 두뇌 (LLM 파이프라인)
    const result = await runTurn({ session, userText, judgment });
    saveSession(session);

    // 4) 입 (TTS)
    const persona = getPersona(session.tutorId);
    const user = getUser();
    const audio = await synthesize(result.reply, persona.voice, {
      speed: user.settings.speechRate,
      feature: "turn",
    });

    const expressionCard = result.new_expression ? findExpression(result.new_expression)?.expr ?? null : null;

    return NextResponse.json({
      userText,
      result: { ...result, audio },
      expressionCard,
      stageState: session.stageState ?? null,
      xp: { total: user.xp, ...xpLevel(user.xp), earned: session.xpEarned },
      combo: session.stageState?.combo ?? 0,
    });
  } catch (e) {
    console.error("[api/turn]", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
