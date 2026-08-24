// 힌트 API — 한국어 입력(텍스트 또는 음성) → "이렇게 말해보세요" 영어 문장

import { NextResponse } from "next/server";
import { loadPrompt } from "@/core/prompts";
import { chatLLM } from "@/core/llm";
import { parseJsonLoose } from "@/core/pipeline/parse";
import { transcribe } from "@/core/stt";
import { getUser } from "@/core/gamification";

export async function POST(req: Request) {
  try {
    let korean = "";
    let lastTutorLine = "";

    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      lastTutorLine = String(form.get("lastTutorLine") ?? "");
      const audio = form.get("audio");
      if (audio instanceof Blob) {
        const buf = Buffer.from(await audio.arrayBuffer());
        const stt = await transcribe(buf, audio.type || "audio/webm", { feature: "hint" });
        korean = stt.text;
      }
    } else {
      const body = await req.json();
      korean = body.korean ?? "";
      lastTutorLine = body.lastTutorLine ?? "";
    }

    if (!korean.trim()) return NextResponse.json({ error: "입력이 비어 있어요" }, { status: 400 });

    const user = getUser();
    const system = loadPrompt("hint", {
      level: String(user.level),
      lastTutorLine,
      koreanInput: korean,
    });
    const res = await chatLLM({
      system,
      messages: [{ role: "user", content: "힌트를 생성해 주세요." }],
      maxTokens: 400,
      feature: "hint",
    });
    const parsed = parseJsonLoose<{ primary?: { en: string; ko: string }; natural?: { en: string; ko: string } }>(res.text);
    if (!parsed?.primary) return NextResponse.json({ error: "힌트 생성에 실패했어요" }, { status: 500 });
    return NextResponse.json({ korean, ...parsed });
  } catch (e) {
    console.error("[api/hint]", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
