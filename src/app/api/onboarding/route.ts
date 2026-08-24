// 온보딩 API — 레벨테스트 평가 + 완료 처리(첫 친구의 첫 메시지 발송)

import { NextResponse } from "next/server";
import { transcribe } from "@/core/stt";
import { loadPrompt } from "@/core/prompts";
import { chatLLM } from "@/core/llm";
import { parseJsonLoose } from "@/core/pipeline/parse";
import { getUser, saveUser, addIntimacy } from "@/core/gamification";
import { getPersona } from "@/core/content";
import { appendTutorMessage } from "@/core/chat";

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") ?? "";

    // 1분 발화 레벨테스트
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const audio = form.get("audio");
      if (!(audio instanceof Blob)) return NextResponse.json({ error: "audio required" }, { status: 400 });
      const buf = Buffer.from(await audio.arrayBuffer());
      const stt = await transcribe(buf, audio.type || "audio/webm", {
        feature: "leveltest",
        durationSec: Number(form.get("durationSec") ?? 60),
      });
      const system = loadPrompt("level-test", { transcript: stt.text || "(발화 없음)" });
      const res = await chatLLM({
        system,
        messages: [{ role: "user", content: "레벨을 평가해 주세요." }],
        maxTokens: 300,
        feature: "leveltest",
      });
      const parsed = parseJsonLoose<{ level?: number; note?: string }>(res.text);
      const level = Math.max(1, Math.min(5, parsed?.level ?? 2));
      return NextResponse.json({ transcript: stt.text, level, note: parsed?.note ?? "" });
    }

    // 온보딩 완료
    const body = await req.json();
    if (body.action === "complete") {
      const { name, level, tutorId, note } = body as { name: string; level: number; tutorId: string; note?: string };
      const user = getUser();
      user.onboarded = true;
      user.name = name || "친구";
      user.level = Math.max(1, Math.min(5, level || 2));
      user.firstTutorId = tutorId;
      if (note) user.levelTestNote = note;
      saveUser(user);

      // 선택한 친구가 바로 첫 메시지를 보낸다
      const persona = getPersona(tutorId);
      appendTutorMessage(tutorId, persona.firstMessage.en, persona.firstMessage.ko);
      addIntimacy(tutorId, 1);

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    console.error("[api/onboarding]", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
