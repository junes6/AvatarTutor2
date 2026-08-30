// 학습자 사진 전송 — 튜터가 사진을 보고 영어로 되묻는다.
// data URL이 커서 일반 채팅 라우트(16KB)와 본문 한도를 분리한다.

import { NextResponse } from "next/server";
import { chatTurn } from "@/core/chat";
import { getPersona } from "@/core/content";
import { parseDataUrl, visionAvailable, VISION_LIMITS } from "@/core/vision";

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_CAPTION_LENGTH = 500;

function privateJson(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "private, no-store");
  return NextResponse.json(data, { ...init, headers });
}

export async function POST(req: Request) {
  try {
    const contentLength = Number(req.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
      return privateJson({ error: "사진이 너무 커요. 5MB 이하로 보내주세요." }, { status: 413 });
    }
    const body = await req.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return privateJson({ error: "invalid request" }, { status: 400 });
    }
    const { tutorId, photo } = body as { tutorId?: string; photo?: string };
    if (typeof tutorId !== "string") return privateJson({ error: "invalid tutorId" }, { status: 400 });
    try {
      getPersona(tutorId);
    } catch {
      return privateJson({ error: "invalid tutorId" }, { status: 400 });
    }
    if (typeof photo !== "string" || !parseDataUrl(photo)) {
      return privateJson(
        { error: `지원하지 않는 이미지예요 (${VISION_LIMITS.ALLOWED_MIME.join(", ")}, 5MB 이하)` },
        { status: 400 },
      );
    }
    const caption = String(body.caption ?? "").slice(0, MAX_CAPTION_LENGTH).trim();

    const result = await chatTurn({ tutorId, text: caption, photoDataUrl: photo, signal: req.signal });
    return privateJson({ ...result, visionAvailable: visionAvailable() });
  } catch (error) {
    if (error instanceof SyntaxError) return privateJson({ error: "invalid JSON" }, { status: 400 });
    console.error("[api/chat/photo]", error);
    return privateJson({ error: "사진을 보내지 못했어요." }, { status: 500 });
  }
}
