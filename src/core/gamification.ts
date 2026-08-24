// XP · 레벨 · 스트릭 · 친밀도 — 공통 게임화 시스템.

import { readJSON, writeJSON, todayStr } from "./store";
import type { UserState, TutorState, MemoryFact } from "./types";

export const DEFAULT_USER: UserState = {
  onboarded: false,
  name: "",
  level: 2,
  xp: 0,
  streak: { count: 0, lastActive: "" },
  settings: {
    subtitles: "always",
    speechRate: 1.0,
    notifications: { enabled: true, morning: true, quiz: true, checkin: true },
  },
  completedUnits: [],
  dailyGoal: { date: "", reviewsDone: 0, unitDone: false, callSeconds: 0 },
};

export function getUser(): UserState {
  const u = readJSON<UserState>("user", DEFAULT_USER);
  // 날짜가 바뀌면 오늘의 목표 리셋
  const today = todayStr();
  if (u.dailyGoal.date !== today) {
    u.dailyGoal = { date: today, reviewsDone: 0, unitDone: false, callSeconds: 0 };
  }
  return u;
}

export function saveUser(u: UserState) {
  writeJSON("user", u);
}

// XP 레벨 곡선: 레벨 n → 누적 n*n*50 XP
export function xpLevel(xp: number): { level: number; cur: number; next: number } {
  let level = 1;
  while (xp >= level * level * 50) level++;
  const prevTotal = (level - 1) * (level - 1) * 50;
  return { level, cur: xp - prevTotal, next: level * level * 50 - prevTotal };
}

export function addXp(amount: number): UserState {
  const u = getUser();
  u.xp += amount;
  touchStreak(u);
  saveUser(u);
  return u;
}

export function touchStreak(u: UserState) {
  const today = todayStr();
  if (u.streak.lastActive === today) return;
  const yesterday = todayStr(new Date(Date.now() - 86400000));
  u.streak.count = u.streak.lastActive === yesterday ? u.streak.count + 1 : 1;
  u.streak.lastActive = today;
}

// ── 친밀도 ──
export const INTIMACY_THRESHOLDS = [0, 50, 150, 300, 500]; // 레벨 1~5 시작 XP

export function intimacyLevel(xp: number): number {
  let lv = 1;
  for (let i = 1; i < INTIMACY_THRESHOLDS.length; i++) {
    if (xp >= INTIMACY_THRESHOLDS[i]) lv = i + 1;
  }
  return lv;
}

export const DEFAULT_TUTOR_STATE: TutorState = { intimacyXp: 0, memory: [], lastInteraction: 0 };

export function getTutorState(tutorId: string): TutorState {
  return readJSON<TutorState>(`tutors/${tutorId}`, { ...DEFAULT_TUTOR_STATE, memory: [] });
}

export function saveTutorState(tutorId: string, s: TutorState) {
  writeJSON(`tutors/${tutorId}`, s);
}

export function addIntimacy(tutorId: string, amount: number): TutorState {
  const s = getTutorState(tutorId);
  s.intimacyXp += amount;
  s.lastInteraction = Date.now();
  saveTutorState(tutorId, s);
  return s;
}

export function addMemoryFacts(tutorId: string, facts: MemoryFact[]) {
  const s = getTutorState(tutorId);
  s.memory.push(...facts);
  // 오래된 기억은 정리 (최근 40개 유지, profile/promise는 우선 보존)
  if (s.memory.length > 40) {
    const keep = s.memory.filter((f) => f.kind === "profile" || f.kind === "promise");
    const rest = s.memory.filter((f) => f.kind !== "profile" && f.kind !== "promise");
    s.memory = [...keep, ...rest.slice(-Math.max(0, 40 - keep.length))];
  }
  saveTutorState(tutorId, s);
}
