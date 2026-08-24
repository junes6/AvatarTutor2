// 웹 푸시 구독 API

import { NextResponse } from "next/server";
import { addSubscription } from "@/core/push";
import { config } from "@/core/config";

export async function GET() {
  return NextResponse.json({ publicKey: config.push.publicKey || null });
}

export async function POST(req: Request) {
  try {
    const sub = await req.json();
    if (!sub?.endpoint) return NextResponse.json({ error: "invalid subscription" }, { status: 400 });
    addSubscription(sub);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
