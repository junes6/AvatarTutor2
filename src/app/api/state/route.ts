// 앱 전역 상태 API — 채팅 목록(홈)과 마이페이지가 함께 사용한다.

import { NextResponse } from "next/server";
import { getUnits } from "@/core/content";
import { getUser, saveUser, getTutorState, intimacyLevel, xpLevel, INTIMACY_THRESHOLDS } from "@/core/gamification";
import { getChat, previewText, unreadCount } from "@/core/chatStore";
import { typingStatus, pendingCount } from "@/core/deliveryQueue";
import { activeFriends, ensureRoster, getRoster, leftFriends, learnerProfile } from "@/core/friends";
import { lifeStatus } from "@/core/life";
import { isAwake, localTimeLabel } from "@/core/rhythm";
import { availableScenarios } from "@/core/roleplay";
import { getPersona } from "@/core/content";
import { getDueItems } from "@/core/srs";
import { peekHealth } from "@/core/health";
import { config } from "@/core/config";
import { recommendUnit } from "@/core/curriculum";
import { getResumableSessions } from "@/core/session";
import { getLearningProgress } from "@/core/learningProgress";
import { parseProfile, sanitizeName } from "@/core/profile";
import type { UserSettings } from "@/core/types";

const MAX_JSON_BYTES = 16 * 1024;
const MAX_NAME_LENGTH = 24;

function privateJson(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "private, no-store");
  return NextResponse.json(data, { ...init, headers });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSettingsPatch(value: unknown): Partial<UserSettings> | null {
  if (!isRecord(value)) return null;
  const allowedKeys = ["subtitles", "speechRate", "notifications", "dailyProactiveLimit", "coachingCards"];
  if (Object.keys(value).some((key) => !allowedKeys.includes(key))) return null;
  const patch: Partial<UserSettings> = {};

  if ("subtitles" in value) {
    if (value.subtitles !== "always" && value.subtitles !== "tap" && value.subtitles !== "off") return null;
    patch.subtitles = value.subtitles;
  }
  if ("speechRate" in value) {
    if (value.speechRate !== 0.8 && value.speechRate !== 1 && value.speechRate !== 1.2) return null;
    patch.speechRate = value.speechRate;
  }
  if ("dailyProactiveLimit" in value) {
    const limit = value.dailyProactiveLimit;
    if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 0 || limit > 6) return null;
    patch.dailyProactiveLimit = limit;
  }
  if ("coachingCards" in value) {
    if (typeof value.coachingCards !== "boolean") return null;
    patch.coachingCards = value.coachingCards;
  }
  if ("notifications" in value) {
    if (!isRecord(value.notifications)) return null;
    const notifications = value.notifications;
    const allowed = ["enabled", "morning", "quiz", "checkin", "life"] as const;
    if (Object.keys(notifications).some((key) => !allowed.includes(key as (typeof allowed)[number]))) return null;
    for (const key of allowed) {
      if (key in notifications && typeof notifications[key] !== "boolean") return null;
    }
    patch.notifications = notifications as unknown as UserSettings["notifications"];
  }
  return patch;
}

function friendCard(tutorId: string, status: "active" | "left") {
  const persona = getPersona(tutorId);
  const thread = getChat(tutorId);
  const last = thread.messages[thread.messages.length - 1] ?? null;
  const tutorState = getTutorState(tutorId);
  const level = intimacyLevel(tutorState.intimacyXp);
  const life = lifeStatus(tutorId);
  return {
    id: persona.id,
    name: persona.name,
    koName: persona.koName,
    emoji: persona.emoji,
    color: persona.color,
    bio: persona.bio,
    profileImage: persona.profileImage,
    status,
    intimacy: { level, xp: tutorState.intimacyXp, next: INTIMACY_THRESHOLDS[level] ?? null },
    unread: unreadCount(tutorId),
    lastMessage: last ? { text: previewText(last), ts: last.ts, role: last.role, kind: last.kind ?? "text" } : null,
    typing: typingStatus(tutorId).typing,
    awake: isAwake(persona.rhythm, Date.now(), life.timezone),
    localTime: localTimeLabel(life.timezone),
    city: life.city,
    travelling: life.travelling,
    memoryCount: tutorState.memory.length,
  };
}

export async function GET() {
  const user = getUser();
  const units = getUnits();
  const recommendation = recommendUnit(units, user.completedUnits, user.level);

  // 온보딩을 마쳤는데 활성 친구가 없으면(초기 진입/이탈 직후) 프로필로 다시 배정한다.
  const roster = user.onboarded ? ensureRoster(learnerProfile()) : getRoster();

  const friends = activeFriends(roster)
    .map((friend) => friendCard(friend.tutorId, "active"))
    // 카톡처럼 최근 메시지 순으로 정렬한다.
    .sort((a, b) => (b.lastMessage?.ts ?? 0) - (a.lastMessage?.ts ?? 0));

  const archived = leftFriends(roster).map((friend) => friendCard(friend.tutorId, "left"));

  return privateJson({
    user,
    profile: user.profile ?? null,
    xp: xpLevel(user.xp),
    friends,
    archivedFriends: archived,
    pendingIntro: roster.pendingIntro,
    pendingDeliveries: pendingCount(),
    units: units.map((unit) => ({
      id: unit.id,
      title: unit.title,
      titleKo: unit.titleKo,
      order: unit.order,
      level: unit.level,
      expressionCount: unit.expressions.length,
      completed: user.completedUnits.includes(unit.id),
    })),
    recommendedUnitId: recommendation?.unit.id ?? null,
    recommendationReason: recommendation?.reason ?? null,
    resumableSessions: getResumableSessions(),
    learningProgress: getLearningProgress(),
    scenarios: availableScenarios(),
    srsDueCount: getDueItems(99).length,
    health: peekHealth(),
    avatarLayer: config.avatar.layer,
  });
}

export async function POST(req: Request) {
  try {
    const contentLength = Number(req.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BYTES) {
      return privateJson({ error: "request too large" }, { status: 413 });
    }
    const body = await req.json();
    if (!isRecord(body)) return privateJson({ error: "invalid request" }, { status: 400 });

    const user = getUser();
    if ("settings" in body) {
      const patch = parseSettingsPatch(body.settings);
      if (!patch) return privateJson({ error: "invalid settings" }, { status: 400 });
      user.settings = {
        ...user.settings,
        ...patch,
        notifications: patch.notifications
          ? { ...user.settings.notifications, ...patch.notifications }
          : user.settings.notifications,
      };
    }
    if ("name" in body) {
      if (typeof body.name !== "string") return privateJson({ error: "invalid name" }, { status: 400 });
      const name = sanitizeName(body.name, MAX_NAME_LENGTH);
      if (!name) {
        return privateJson({ error: `name must be 1-${MAX_NAME_LENGTH} characters` }, { status: 400 });
      }
      user.name = name;
    }
    if ("profile" in body) {
      const profile = parseProfile(body.profile);
      if (!profile) return privateJson({ error: "invalid profile" }, { status: 400 });
      user.profile = profile;
    }
    saveUser(user);
    return privateJson({ ok: true, user });
  } catch (error) {
    if (error instanceof SyntaxError) return privateJson({ error: "invalid JSON" }, { status: 400 });
    console.error("[api/state]", error);
    return privateJson({ error: "state request failed" }, { status: 500 });
  }
}
