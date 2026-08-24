// L2 아바타 세션 토큰 발급 — 키가 서버에만 있으므로 클라이언트 대신 발급한다

import { NextResponse } from "next/server";
import { createL2Session } from "@/core/avatar/l2";

export async function POST(req: Request) {
  const { tutorId } = (await req.json()) as { tutorId: string };
  const session = await createL2Session(tutorId ?? "");
  return NextResponse.json(session, { status: session.ok ? 200 : 200 });
}
