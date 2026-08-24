// 앱 전역 상태 API — 홈/설정 화면이 사용

import { NextResponse } from "next/server";
import { getPersonas, getUnits, getScenarios } from "@/core/content";
import { getUser, saveUser, getTutorState, intimacyLevel, xpLevel, INTIMACY_THRESHOLDS } from "@/core/gamification";
import { getChat } from "@/core/chat";
import { getDueItems } from "@/core/srs";
import { isMockLLM, isMockSTT, isMockTTS, config } from "@/core/config";
import type { UserSettings } from "@/core/types";

export async function GET() {
  const user = getUser();
  const personas = getPersonas();

  const tutors = personas.map((p) => {
    const ts = getTutorState(p.id);
    const chat = getChat(p.id);
    const last = chat.messages[chat.messages.length - 1];
    const level = intimacyLevel(ts.intimacyXp);
    const nextThreshold = INTIMACY_THRESHOLDS[level] ?? null; // level이 5면 null
    return {
      ...p,
      intimacy: {
        level,
        xp: ts.intimacyXp,
        next: nextThreshold,
      },
      unread: chat.messages.filter((m) => !m.read && m.role === "tutor").length,
      lastMessage: last ? { text: last.text, ts: last.ts, role: last.role } : null,
      memoryCount: ts.memory.length,
    };
  });

  return NextResponse.json({
    user,
    xp: xpLevel(user.xp),
    tutors,
    units: getUnits().map((u) => ({
      id: u.id,
      title: u.title,
      titleKo: u.titleKo,
      order: u.order,
      level: u.level,
      expressionCount: u.expressions.length,
      completed: user.completedUnits.includes(u.id),
    })),
    scenarios: getScenarios(),
    srsDueCount: getDueItems(99).length,
    mock: { llm: isMockLLM(), stt: isMockSTT(), tts: isMockTTS() },
    avatarLayer: config.avatar.layer,
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const user = getUser();
    if (body.settings) {
      user.settings = { ...user.settings, ...(body.settings as Partial<UserSettings>) };
      saveUser(user);
    }
    if (typeof body.name === "string") {
      user.name = body.name;
      saveUser(user);
    }
    return NextResponse.json({ ok: true, user });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
