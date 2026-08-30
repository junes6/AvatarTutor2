// 연결 상태 — 키 존재 여부가 아니라 실제 호출로 검증한 결과를 돌려준다.
// UI는 이 응답만 보고 "데모 모드" 배너를 띄운다.

import { NextResponse } from "next/server";
import { getHealth } from "@/core/health";
import { config, isRealtimeReady } from "@/core/config";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get("force") === "1";
  const report = await getHealth({ force });
  return NextResponse.json(
    {
      ...report,
      runtime: "single-node-json",
      realtime: isRealtimeReady() ? config.openai.realtimeModel : "not-enabled",
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    },
    {
      status: report.storage === "writable" ? 200 : 503,
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}
