// 친구 관계 — 매칭 배정, 행동 신호 누적, 이탈 처리, 새 친구 유입 예약.
// 학습 데이터(레벨·SRS·XP)는 계정에 귀속되고, 여기에는 관계 상태만 붙는다.

import { readJSON, writeJSON } from "./store";
import { getPersona, getPersonas } from "./content";
import { getUser } from "./gamification";
import { EMPTY_MODEL, rankTutors, updateModelOnEngagement, updateModelOnLeave } from "./matching";
import { cancelTutor } from "./deliveryQueue";
import type {
  FriendRelation,
  FriendRoster,
  LearnerProfile,
  LeaveReason,
  MatchScore,
  PendingIntro,
  RelationshipStats,
} from "./types";

const ROSTER_FILE = "friends";
const INITIAL_FRIENDS = 2;
const HOUR = 60 * 60_000;

/** 온보딩 이전 데이터와 외부 채널을 위한 중립 프로필. */
export const NEUTRAL_PROFILE: LearnerProfile = {
  ageBand: "20s",
  occupation: "office",
  interests: ["travel", "food", "music"],
  goal: "hobby",
  style: "lively",
};

function emptyStats(): RelationshipStats {
  return {
    tutorMessages: 0,
    learnerMessages: 0,
    shortReplies: 0,
    calls: 0,
    callSeconds: 0,
    lastLearnerMessageAt: 0,
    currentStreakTurns: 0,
    longestStreakTurns: 0,
  };
}

function emptyRoster(): FriendRoster {
  return { friends: [], pendingIntro: null, model: { ...EMPTY_MODEL, weights: {} } };
}

function normalize(roster: FriendRoster): FriendRoster {
  if (!Array.isArray(roster.friends)) roster.friends = [];
  if (!roster.model || typeof roster.model !== "object") roster.model = { ...EMPTY_MODEL, weights: {} };
  if (!roster.model.weights) roster.model.weights = {};
  for (const friend of roster.friends) {
    friend.stats = { ...emptyStats(), ...(friend.stats ?? {}) };
  }
  return roster;
}

export function getRoster(): FriendRoster {
  return normalize(readJSON<FriendRoster>(ROSTER_FILE, emptyRoster()));
}

export function saveRoster(roster: FriendRoster) {
  writeJSON(ROSTER_FILE, roster);
}

export function learnerProfile(): LearnerProfile {
  return getUser().profile ?? NEUTRAL_PROFILE;
}

export function statsByTutor(roster = getRoster()): Record<string, RelationshipStats> {
  return Object.fromEntries(roster.friends.map((friend) => [friend.tutorId, friend.stats]));
}

/** 새 친구 후보 순위 — 이미 사귀었거나 떠나보낸 친구는 제외한다. */
export function rankCandidates(roster = getRoster(), profile = learnerProfile()): MatchScore[] {
  return rankTutors({
    personas: getPersonas(),
    profile,
    model: roster.model,
    exclude: roster.friends.map((friend) => friend.tutorId),
    includeEngagement: false,
  });
}

/** 활성 친구를 궁합 순으로 — 채팅 목록 정렬의 2차 기준. */
export function rankActive(roster = getRoster(), profile = learnerProfile()): MatchScore[] {
  const active = new Set(roster.friends.filter((f) => f.status === "active").map((f) => f.tutorId));
  return rankTutors({
    personas: getPersonas().filter((persona) => active.has(persona.id)),
    profile,
    model: roster.model,
    stats: statsByTutor(roster),
  });
}

function addFriend(roster: FriendRoster, tutorId: string, introducedBy?: string): FriendRelation {
  const existing = roster.friends.find((friend) => friend.tutorId === tutorId);
  if (existing) {
    existing.status = "active";
    existing.leftAt = undefined;
    existing.leaveReason = undefined;
    if (introducedBy) existing.introducedBy = introducedBy;
    return existing;
  }
  const relation: FriendRelation = {
    tutorId,
    status: "active",
    addedAt: Date.now(),
    introducedBy,
    stats: emptyStats(),
  };
  roster.friends.push(relation);
  return relation;
}

/**
 * 첫 매칭은 프로필 기반 2명. 한 번에 많은 친구를 주면 관계가 얕아진다.
 * 온보딩 완료 직후와, 기존 사용자가 처음 새 구조에 진입할 때 모두 여기로 온다.
 */
export function ensureRoster(profile = learnerProfile()): FriendRoster {
  const roster = getRoster();
  const active = roster.friends.filter((friend) => friend.status === "active");
  if (active.length > 0) return roster;
  if (roster.pendingIntro) return roster; // 새 친구가 오는 중이면 강제로 채우지 않는다

  const picks = rankCandidates(roster, profile).slice(0, INITIAL_FRIENDS);
  if (picks.length === 0) return roster;
  for (const pick of picks) addFriend(roster, pick.tutorId);
  saveRoster(roster);
  return roster;
}

export function activeFriends(roster = getRoster()): FriendRelation[] {
  return roster.friends.filter((friend) => friend.status === "active");
}

export function leftFriends(roster = getRoster()): FriendRelation[] {
  return roster.friends
    .filter((friend) => friend.status === "left")
    .sort((a, b) => (b.leftAt ?? 0) - (a.leftAt ?? 0));
}

export function getRelation(tutorId: string, roster = getRoster()): FriendRelation | undefined {
  return roster.friends.find((friend) => friend.tutorId === tutorId);
}

export function isActiveFriend(tutorId: string): boolean {
  return getRelation(tutorId)?.status === "active";
}

// ── 행동 신호 ──

const SHORT_REPLY_WORDS = 3;

export function recordLearnerMessage(tutorId: string, text: string) {
  const roster = getRoster();
  const friend = getRelation(tutorId, roster) ?? addFriend(roster, tutorId);
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  friend.stats.learnerMessages += 1;
  friend.stats.lastLearnerMessageAt = Date.now();
  friend.stats.currentStreakTurns += 1;
  friend.stats.longestStreakTurns = Math.max(friend.stats.longestStreakTurns, friend.stats.currentStreakTurns);
  if (words > 0 && words <= SHORT_REPLY_WORDS) friend.stats.shortReplies += 1;
  else friend.stats.shortReplies = Math.max(0, friend.stats.shortReplies - 1);
  saveRoster(roster);
}

export function recordTutorMessage(tutorId: string) {
  const roster = getRoster();
  const friend = getRelation(tutorId, roster) ?? addFriend(roster, tutorId);
  friend.stats.tutorMessages += 1;
  saveRoster(roster);
}

/** 튜터가 먼저 보냈는데 답이 없으면 연속 턴이 끊긴 것으로 본다. */
export function breakStreak(tutorId: string) {
  const roster = getRoster();
  const friend = getRelation(tutorId, roster);
  if (!friend || friend.stats.currentStreakTurns === 0) return;
  friend.stats.currentStreakTurns = 0;
  saveRoster(roster);
}

export function recordCall(tutorId: string, seconds: number) {
  const roster = getRoster();
  const friend = getRelation(tutorId, roster) ?? addFriend(roster, tutorId);
  friend.stats.calls += 1;
  friend.stats.callSeconds += Math.max(0, Math.round(seconds));
  // 통화는 가장 강한 긍정 신호다 — 즉시 궁합 모델에 반영한다.
  roster.model = updateModelOnEngagement(roster.model, getPersona(tutorId), friend.stats);
  saveRoster(roster);
}

// ── 이탈 → 재유입 ──

function introDelayMs(hasOtherFriends: boolean): number {
  const override = Number(process.env.FRIEND_INTRO_DELAY_MS);
  if (Number.isFinite(override) && override >= 0) return override;
  // 친구가 아무도 남지 않았다면 오래 혼자 두지 않는다.
  if (!hasOtherFriends) return 20 * 60_000 + Math.random() * 40 * 60_000;
  return 3 * HOUR + Math.random() * 21 * HOUR;
}

export interface LeaveResult {
  left: FriendRelation | null;
  pendingIntro: PendingIntro | null;
}

/**
 * 채팅방 나가기 — 기록은 보관하고(언제든 재개 가능) 궁합 모델만 갱신한 뒤
 * 갱신된 취향에 맞는 새 친구를 '친구의 소개' 형태로 예약한다.
 */
export function leaveFriend(tutorId: string, reason: LeaveReason = "none"): LeaveResult {
  const roster = getRoster();
  const friend = getRelation(tutorId, roster);
  if (!friend || friend.status === "left") return { left: friend ?? null, pendingIntro: roster.pendingIntro };

  friend.status = "left";
  friend.leftAt = Date.now();
  friend.leaveReason = reason;
  friend.stats.currentStreakTurns = 0;
  roster.model = updateModelOnLeave(roster.model, getPersona(tutorId), reason);

  // 예약돼 있던 답장·능동 메시지는 떠난 친구에게서 더 오지 않는다.
  cancelTutor(tutorId);

  const remaining = roster.friends.filter((item) => item.status === "active");
  const candidate = rankCandidates(roster)[0];
  roster.pendingIntro = candidate
    ? {
        tutorId: candidate.tutorId,
        dueAt: Date.now() + introDelayMs(remaining.length > 0),
        introducedBy: tutorId,
        reason,
      }
    : null;
  saveRoster(roster);
  return { left: friend, pendingIntro: roster.pendingIntro };
}

/** 떠난 친구와 다시 대화 시작 — 기록은 그대로 이어진다. */
export function restoreFriend(tutorId: string): FriendRelation | null {
  const roster = getRoster();
  const friend = getRelation(tutorId, roster);
  if (!friend) return null;
  friend.status = "active";
  friend.leftAt = undefined;
  friend.leaveReason = undefined;
  saveRoster(roster);
  return friend;
}

export function dueIntro(now = Date.now()): PendingIntro | null {
  const pending = getRoster().pendingIntro;
  return pending && pending.dueAt <= now ? pending : null;
}

/** 소개 메시지를 실제로 보낸 뒤 호출 — 친구를 활성으로 올리고 예약을 비운다. */
export function completeIntro(tutorId: string): FriendRelation {
  const roster = getRoster();
  const pending = roster.pendingIntro;
  const relation = addFriend(roster, tutorId, pending?.introducedBy);
  if (pending?.tutorId === tutorId) roster.pendingIntro = null;
  saveRoster(roster);
  return relation;
}

export function cancelIntro() {
  const roster = getRoster();
  if (!roster.pendingIntro) return;
  roster.pendingIntro = null;
  saveRoster(roster);
}
