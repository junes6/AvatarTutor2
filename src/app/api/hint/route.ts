// 힌트 API — 한국어 입력(텍스트 또는 음성) → "이렇게 말해보세요" 영어 문장

import { NextResponse } from "next/server";
import { loadPrompt } from "@/core/prompts";
import { chatLLM } from "@/core/llm";
import { parseJsonLoose } from "@/core/pipeline/parse";
import { transcribe } from "@/core/stt";
import { getUser } from "@/core/gamification";
import { escapePromptData } from "@/core/pipeline/systemPrompt";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_KOREAN_LENGTH = 1_000;
const MAX_CONTEXT_LENGTH = 2_000;
const MAX_JSON_BYTES = 16 * 1024;

export async function POST(req: Request) {
  try {
    let korean = "";
    let lastTutorLine = "";

    const contentType = req.headers.get("content-type") ?? "";
    const contentLength = Number(req.headers.get("content-length") ?? 0);
    const maxRequestBytes = contentType.includes("multipart/form-data")
      ? MAX_AUDIO_BYTES + 1024 * 1024
      : MAX_JSON_BYTES;
    if (Number.isFinite(contentLength) && contentLength > maxRequestBytes) {
      return NextResponse.json({ error: "요청이 너무 커요" }, { status: 413 });
    }
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      lastTutorLine = String(form.get("lastTutorLine") ?? "");
      const clientTranscript = String(form.get("text") ?? "").trim();
      if (clientTranscript.length > MAX_KOREAN_LENGTH || lastTutorLine.length > MAX_CONTEXT_LENGTH) {
        return NextResponse.json({ error: "입력이 너무 길어요" }, { status: 413 });
      }
      korean = clientTranscript;
      const audio = form.get("audio");
      if (audio instanceof Blob) {
        if (audio.size > MAX_AUDIO_BYTES) {
          return NextResponse.json({ error: "음성 파일이 너무 커요" }, { status: 413 });
        }
        const buf = Buffer.from(await audio.arrayBuffer());
        try {
          const stt = await transcribe(buf, audio.type || "audio/webm", {
            feature: "hint",
            language: "ko",
            prompt: "한국어로 말한 학습자의 의도를 그대로 받아쓰세요. 영어 단어가 섞이면 들린 그대로 유지하세요.",
            signal: req.signal,
          });
          korean = stt.text || clientTranscript;
        } catch (error) {
          if (!clientTranscript) throw error;
          console.warn("[api/hint] server STT failed; using client transcript preview");
        }
      }
    } else {
      const parsed = await req.json();
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return NextResponse.json({ error: "잘못된 요청이에요" }, { status: 400 });
      }
      const body = parsed as Record<string, unknown>;
      korean = typeof body.korean === "string" ? body.korean : "";
      lastTutorLine = typeof body.lastTutorLine === "string" ? body.lastTutorLine : "";
    }

    if (!korean.trim()) return NextResponse.json({ error: "입력이 비어 있어요" }, { status: 400 });
    if (korean.length > MAX_KOREAN_LENGTH || lastTutorLine.length > MAX_CONTEXT_LENGTH) {
      return NextResponse.json({ error: "입력이 너무 길어요" }, { status: 413 });
    }

    const user = getUser();
    const system = loadPrompt("hint", {
      level: String(user.level),
      lastTutorLine: escapePromptData(lastTutorLine),
      koreanInput: escapePromptData(korean),
    });
    const res = await chatLLM({
      system,
      messages: [{ role: "user", content: "힌트를 생성해 주세요." }],
      maxTokens: 400,
      feature: "hint",
      signal: req.signal,
    });
    const parsed = parseJsonLoose<{
      primary?: { en: string; ko: string };
      natural?: { en: string; ko: string };
      unavailable?: boolean;
      message?: string;
    }>(res.text);
    if (parsed?.unavailable) {
      return NextResponse.json(
        { error: parsed.message || "현재 정확한 영어 힌트를 만들 수 없어요.", code: "hint_translation_unavailable" },
        { status: 503 },
      );
    }
    if (!parsed?.primary) return NextResponse.json({ error: "힌트 생성에 실패했어요" }, { status: 500 });
    return NextResponse.json({ korean, ...parsed });
  } catch (e) {
    if (e instanceof SyntaxError) {
      return NextResponse.json({ error: "잘못된 JSON이에요" }, { status: 400 });
    }
    console.error("[api/hint]", e);
    return NextResponse.json({ error: "힌트 요청을 처리하지 못했어요" }, { status: 500 });
  }
}
