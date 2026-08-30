// L2 아바타 세션 토큰 발급 — 키가 서버에만 있으므로 클라이언트 대신 발급한다

import { NextResponse } from "next/server";
import { createL2Session } from "@/core/avatar/l2";
import { getPersona } from "@/core/content";

export async function POST(req: Request) {
  try {
    const contentLength = Number(req.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > 8 * 1024) {
      return NextResponse.json({ ok: false, reason: "요청이 너무 큼" }, { status: 413 });
    }
    const parsed = await req.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return NextResponse.json({ ok: false, reason: "잘못된 요청" }, { status: 400 });
    }
    const body = parsed as { tutorId?: unknown };
    const tutorId = typeof body.tutorId === "string" ? body.tutorId.trim() : "";
    try {
      getPersona(tutorId);
    } catch {
      return NextResponse.json({ ok: false, reason: "잘못된 튜터" }, { status: 400 });
    }
    const session = await createL2Session(tutorId, req.signal);
    // Provider 미설정/장애는 클라이언트의 L1/L0 폴백 조건이므로 정상 JSON으로 전달한다.
    return NextResponse.json(session, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ ok: false, reason: "잘못된 JSON" }, { status: 400 });
    }
    console.error("[api/avatar/session]", error);
    return NextResponse.json({ ok: false, reason: "아바타 세션 요청 실패" }, { status: 500 });
  }
}
