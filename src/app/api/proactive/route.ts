// 능동 메시지 tick — 클라이언트가 홈 진입/주기 폴링으로 호출

import { NextResponse } from "next/server";
import { tick } from "@/core/proactive";

export async function POST() {
  try {
    const result = await tick();
    return NextResponse.json(result);
  } catch (e) {
    console.error("[api/proactive]", e);
    return NextResponse.json({ generated: null, error: String(e) }, { status: 500 });
  }
}
