// 상황극 브리핑 — 시작 전에 상황·역할·미션·쓸만한 표현 3개를 보여준다.

import { NextResponse } from "next/server";
import { availableScenarios, buildBriefing } from "@/core/roleplay";

function privateJson(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "private, no-store");
  return NextResponse.json(data, { ...init, headers });
}

export async function GET(req: Request) {
  const scenarioId = new URL(req.url).searchParams.get("scenario");
  if (!scenarioId) {
    return privateJson({ scenarios: availableScenarios() });
  }
  const briefing = buildBriefing(scenarioId);
  if (!briefing) return privateJson({ error: "unknown scenario" }, { status: 404 });
  return privateJson({ briefing });
}
