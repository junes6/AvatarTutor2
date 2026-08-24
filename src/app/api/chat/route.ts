// 채팅 API — 메시지 조회 / 전송 / 읽음 처리

import { NextResponse } from "next/server";
import { getChat, chatTurn, markRead } from "@/core/chat";

export async function GET(req: Request) {
  const tutorId = new URL(req.url).searchParams.get("tutorId");
  if (!tutorId) return NextResponse.json({ error: "tutorId required" }, { status: 400 });
  return NextResponse.json({ messages: getChat(tutorId).messages });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { tutorId } = body as { tutorId: string };

    if (body.action === "read") {
      markRead(tutorId);
      return NextResponse.json({ ok: true });
    }

    const text = String(body.text ?? "").trim();
    if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });
    const result = await chatTurn(tutorId, text);
    return NextResponse.json(result);
  } catch (e) {
    console.error("[api/chat]", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
