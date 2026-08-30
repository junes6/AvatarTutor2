// 스케줄러 tick — 예약 도착 · 새 친구 소개 · 라이프 사진 · 능동 메시지.
// 클라이언트가 주기적으로 호출하고, 외부 크론에서도 호출할 수 있다.

import { NextResponse } from "next/server";
import { tick } from "@/core/proactive";
import { drainDeliveries } from "@/core/proactive";
import { pendingCount } from "@/core/deliveryQueue";
import { unreadCount } from "@/core/chatStore";
import { activeFriends } from "@/core/friends";

function privateJson(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "private, no-store");
  return NextResponse.json(data, { ...init, headers });
}

function unreadByTutor() {
  return Object.fromEntries(activeFriends().map((friend) => [friend.tutorId, unreadCount(friend.tutorId)]));
}

/** 가벼운 경로 — 예약 도착만 처리한다 (채팅방 폴링용). */
export async function GET() {
  const delivered = await drainDeliveries();
  return privateJson({
    delivered: delivered.length,
    tutorIds: delivered.map((entry) => entry.tutorId),
    pending: pendingCount(),
    unread: unreadByTutor(),
  });
}

export async function POST() {
  try {
    const result = await tick();
    return privateJson({ ...result, pending: pendingCount(), unread: unreadByTutor() });
  } catch (error) {
    console.error("[api/tick]", error);
    return privateJson({ generated: null, delivered: 0, error: "tick failed" }, { status: 500 });
  }
}
