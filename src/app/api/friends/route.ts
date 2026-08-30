// 친구 API — 목록/궁합, 채팅방 나가기, 다시 대화하기.

import { NextResponse } from "next/server";
import { getPersona, getPersonas } from "@/core/content";
import {
  activeFriends,
  getRoster,
  leaveFriend,
  leftFriends,
  learnerProfile,
  rankActive,
  rankCandidates,
  restoreFriend,
} from "@/core/friends";
import { normalizedScore } from "@/core/matching";
import { getChat, previewText, unreadCount } from "@/core/chatStore";
import { typingStatus } from "@/core/deliveryQueue";
import { lifeStatus } from "@/core/life";
import { isAwake, localTimeLabel } from "@/core/rhythm";
import type { LeaveReason } from "@/core/types";

const MAX_JSON_BYTES = 8 * 1024;
const LEAVE_REASONS: LeaveReason[] = ["mismatch", "too-hard", "too-easy", "slow", "none"];

function privateJson(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "private, no-store");
  return NextResponse.json(data, { ...init, headers });
}

function summarize(tutorId: string, extra: Record<string, unknown> = {}) {
  const persona = getPersona(tutorId);
  const thread = getChat(tutorId);
  const last = thread.messages[thread.messages.length - 1] ?? null;
  const status = lifeStatus(tutorId);
  return {
    id: persona.id,
    name: persona.name,
    koName: persona.koName,
    emoji: persona.emoji,
    color: persona.color,
    bio: persona.bio,
    profileImage: persona.profileImage,
    tags: persona.tags,
    unread: unreadCount(tutorId),
    lastMessage: last ? { text: previewText(last), ts: last.ts, role: last.role } : null,
    typing: typingStatus(tutorId).typing,
    awake: isAwake(persona.rhythm, Date.now(), status.timezone),
    localTime: localTimeLabel(status.timezone),
    city: status.city,
    travelling: status.travelling,
    ...extra,
  };
}

export async function GET() {
  const roster = getRoster();
  const profile = learnerProfile();
  const ranked = new Map(rankActive(roster, profile).map((score) => [score.tutorId, score]));

  const active = activeFriends(roster).map((friend) => {
    const score = ranked.get(friend.tutorId);
    return summarize(friend.tutorId, {
      status: "active",
      addedAt: friend.addedAt,
      introducedBy: friend.introducedBy ?? null,
      match: score ? { score: normalizedScore(score.score), reasons: score.reasons } : null,
      stats: friend.stats,
    });
  });

  const left = leftFriends(roster).map((friend) =>
    summarize(friend.tutorId, {
      status: "left",
      leftAt: friend.leftAt ?? null,
      leaveReason: friend.leaveReason ?? null,
    }),
  );

  const candidates = rankCandidates(roster, profile).map((score) => ({
    ...summarize(score.tutorId, { status: "candidate" }),
    match: { score: normalizedScore(score.score), reasons: score.reasons },
  }));

  return privateJson({
    active,
    left,
    candidates,
    pendingIntro: roster.pendingIntro,
    profile,
    totalPersonas: getPersonas().length,
    model: roster.model,
  });
}

export async function POST(req: Request) {
  try {
    const contentLength = Number(req.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BYTES) {
      return privateJson({ error: "request too large" }, { status: 413 });
    }
    const body = await req.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return privateJson({ error: "invalid request" }, { status: 400 });
    }
    const tutorId = String((body as { tutorId?: string }).tutorId ?? "");
    try {
      getPersona(tutorId);
    } catch {
      return privateJson({ error: "invalid tutorId" }, { status: 400 });
    }

    if (body.action === "leave") {
      const raw = String(body.reason ?? "none") as LeaveReason;
      const reason = LEAVE_REASONS.includes(raw) ? raw : "none";
      const result = leaveFriend(tutorId, reason);
      return privateJson({
        ok: true,
        left: result.left,
        pendingIntro: result.pendingIntro,
        // 새 친구가 언제 올지 알려 주면 '버려진 느낌'이 들지 않는다.
        nextFriendInMinutes: result.pendingIntro
          ? Math.max(1, Math.round((result.pendingIntro.dueAt - Date.now()) / 60_000))
          : null,
      });
    }

    if (body.action === "restore") {
      const restored = restoreFriend(tutorId);
      if (!restored) return privateJson({ error: "unknown friend" }, { status: 404 });
      return privateJson({ ok: true, friend: restored });
    }

    return privateJson({ error: "unknown action" }, { status: 400 });
  } catch (error) {
    if (error instanceof SyntaxError) return privateJson({ error: "invalid JSON" }, { status: 400 });
    console.error("[api/friends]", error);
    return privateJson({ error: "friends request failed" }, { status: 500 });
  }
}
