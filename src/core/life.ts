// 라이프 스케줄러 — 튜터의 앞으로 2~4주치 일정을 미리 만들어 두고,
// 그 일정에 맞춰 사진 메시지를 보내고 대화 컨텍스트에 "지금 나는 어디서 뭘 하는 중"을 주입한다.

import { readJSON, writeJSON, todayStr, addDays, uid } from "./store";
import { loadPrompt } from "./prompts";
import { chatLLM } from "./llm";
import { parseJsonLoose } from "./pipeline/parse";
import { escapePromptData } from "./pipeline/systemPrompt";
import { getPersona } from "./content";
import { isMockLLM } from "./config";
import { fetchPhoto } from "./photos";
import type { ChatPhoto, LifeEvent, LifeEventKind, LifeSchedule, TutorPersona } from "./types";

const HORIZON_DAYS = 21;
/** 남은 일정이 이 날짜 수 아래로 떨어지면 다음 구간을 이어 만든다. */
const REFRESH_THRESHOLD_DAYS = 5;
const MAX_EVENTS = 16;
const VALID_KINDS: LifeEventKind[] = ["travel", "work", "weekend", "hobby", "daily"];

function file(tutorId: string) {
  return `life/${tutorId}`;
}

function emptySchedule(tutorId: string): LifeSchedule {
  return {
    tutorId,
    generatedAt: 0,
    coversUntil: "",
    events: [],
    usedPhotos: [],
    lastPostedDate: "",
    postsToday: 0,
  };
}

export function getSchedule(tutorId: string): LifeSchedule {
  const schedule = readJSON<LifeSchedule>(file(tutorId), emptySchedule(tutorId));
  if (!Array.isArray(schedule.events)) schedule.events = [];
  if (!Array.isArray(schedule.usedPhotos)) schedule.usedPhotos = [];
  return schedule;
}

export function saveSchedule(schedule: LifeSchedule) {
  // 사진 이력이 무한히 자라지 않게 최근 200장만 기억한다.
  if (schedule.usedPhotos.length > 200) schedule.usedPhotos = schedule.usedPhotos.slice(-200);
  writeJSON(file(schedule.tutorId), schedule);
}

function dayOffset(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00`) - Date.parse(`${from}T00:00:00`)) / 86_400_000);
}

function weekdayOf(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00`).getDay();
}

/**
 * LLM 없이도 일정이 끊기지 않게 하는 결정적 생성기.
 * 목 모드에서도 여행 → 복귀의 연속성이 유지되어야 대화가 일관된다.
 */
export function buildFallbackSchedule(persona: TutorPersona, start = todayStr(), days = HORIZON_DAYS): LifeEvent[] {
  const events: LifeEvent[] = [];
  const themes = persona.life.themes.length > 0 ? persona.life.themes : ["일상"];
  const home = persona.life.homeCity;
  const homeZone = persona.rhythm.timezone;

  // 여행: 기간의 중반에 4일. 목적지는 페르소나별로 고정 회전한다.
  const destinations = persona.life.travelDestinations;
  const travelStart = addDays(start, Math.floor(days * 0.4));
  const travelEnd = addDays(travelStart, 3);
  const destination = destinations[Math.floor(Date.parse(`${start}T00:00:00`) / 86_400_000) % destinations.length];
  if (destination) {
    events.push({
      id: uid("ev"),
      kind: "travel",
      title: `${destination.city} 여행`,
      detail: `${destination.city}에 며칠 다녀오는 중입니다. ${persona.life.travelStyle}`,
      city: destination.city,
      timezone: destination.timezone,
      startDate: travelStart,
      endDate: travelEnd,
      photoKeywords: [destination.keyword, ...persona.life.photoKeywords.food.slice(0, 1)],
      posts: 0,
    });
    events.push({
      id: uid("ev"),
      kind: "daily",
      title: "여행에서 돌아와 일상 복귀",
      detail: `${destination.city}에서 막 돌아와 시차와 밀린 일에 치이는 중입니다.`,
      city: home,
      timezone: homeZone,
      startDate: addDays(travelEnd, 1),
      endDate: addDays(travelEnd, 3),
      photoKeywords: persona.life.photoKeywords.daily.slice(0, 2),
      posts: 0,
    });
  }

  // 일상/취미/주말: 테마를 순회하며 2~3일짜리 블록으로 깐다.
  let cursor = start;
  let index = 0;
  while (dayOffset(start, cursor) < days) {
    const inTravel = destination ? cursor >= travelStart && cursor <= addDays(travelEnd, 3) : false;
    if (!inTravel) {
      const theme = themes[index % themes.length];
      const weekend = weekdayOf(cursor) === 0 || weekdayOf(cursor) === 6;
      const kind: LifeEventKind = weekend ? "weekend" : index % 3 === 0 ? "work" : "hobby";
      events.push({
        id: uid("ev"),
        kind,
        title: theme,
        detail: `${theme} — ${persona.life.homeCity}에서의 평범한 며칠입니다.`,
        city: home,
        timezone: homeZone,
        startDate: cursor,
        endDate: addDays(cursor, 1),
        photoKeywords:
          kind === "weekend"
            ? persona.life.photoKeywords.place.slice(0, 2)
            : index % 2 === 0
              ? persona.life.photoKeywords.daily.slice(0, 2)
              : persona.life.photoKeywords.food.slice(0, 2),
        posts: 0,
      });
      index++;
    }
    cursor = addDays(cursor, 2);
  }
  return events.slice(0, MAX_EVENTS);
}

interface RawEvent {
  kind?: unknown;
  title?: unknown;
  detail?: unknown;
  city?: unknown;
  timezone?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  photoKeywords?: unknown;
}

function sanitizeEvents(raw: unknown, persona: TutorPersona, start: string, days: number): LifeEvent[] {
  const parsed = raw as { events?: RawEvent[] } | null;
  const last = addDays(start, days);
  const events: LifeEvent[] = [];
  for (const item of parsed?.events ?? []) {
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const startDate = typeof item.startDate === "string" ? item.startDate.slice(0, 10) : "";
    const endDate = typeof item.endDate === "string" ? item.endDate.slice(0, 10) : startDate;
    if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) continue;
    if (startDate < start || startDate > last) continue;
    const kind = VALID_KINDS.includes(item.kind as LifeEventKind) ? (item.kind as LifeEventKind) : "daily";
    const keywords = Array.isArray(item.photoKeywords)
      ? item.photoKeywords.filter((value): value is string => typeof value === "string" && value.trim().length > 0).slice(0, 3)
      : [];
    events.push({
      id: uid("ev"),
      kind,
      title,
      detail: typeof item.detail === "string" ? item.detail.trim() : title,
      city: typeof item.city === "string" && item.city.trim() ? item.city.trim() : persona.life.homeCity,
      timezone:
        typeof item.timezone === "string" && item.timezone.includes("/") ? item.timezone : persona.rhythm.timezone,
      startDate,
      endDate: /^\d{4}-\d{2}-\d{2}$/.test(endDate) && endDate >= startDate ? endDate : startDate,
      photoKeywords: keywords.length > 0 ? keywords : persona.life.photoKeywords.daily.slice(0, 2),
      posts: 0,
    });
    if (events.length >= MAX_EVENTS) break;
  }
  return events;
}

/** 일정이 없거나 곧 끝나면 다음 2~4주를 만든다. */
export async function ensureSchedule(tutorId: string, now = Date.now()): Promise<LifeSchedule> {
  const schedule = getSchedule(tutorId);
  const today = todayStr(new Date(now));
  const remaining = schedule.coversUntil ? dayOffset(today, schedule.coversUntil) : -1;
  if (remaining >= REFRESH_THRESHOLD_DAYS) return schedule;

  const persona = getPersona(tutorId);
  const start = remaining > 0 ? addDays(schedule.coversUntil, 1) : today;
  const days = HORIZON_DAYS;

  let events: LifeEvent[] = [];
  if (!isMockLLM()) {
    try {
      const system = loadPrompt("life-schedule", {
        name: persona.name,
        age: String(persona.age),
        job: escapePromptData(persona.job),
        nationality: escapePromptData(persona.nationality),
        personality: escapePromptData(persona.personality),
        interests: escapePromptData(persona.interests.join(", ")),
        homeCity: persona.life.homeCity,
        themes: escapePromptData(persona.life.themes.join(" / ")),
        travelStyle: escapePromptData(persona.life.travelStyle),
        destinations: persona.life.travelDestinations
          .map((destination) => `${destination.city} (${destination.timezone})`)
          .join(", "),
        days: String(days),
        today: start,
        lastDay: addDays(start, days),
        eventCount: "10",
      });
      const result = await chatLLM({
        system,
        messages: [{ role: "user", content: "일정을 만들어 주세요." }],
        maxTokens: 2000,
        feature: "life-schedule",
      });
      events = sanitizeEvents(parseJsonLoose(result.text), persona, start, days);
    } catch (error) {
      console.error("[life] schedule generation failed:", error);
    }
  }
  if (events.length === 0) events = buildFallbackSchedule(persona, start, days);

  // 과거 이벤트는 정리하되 오늘 진행 중인 것은 남긴다.
  const kept = schedule.events.filter((event) => event.endDate >= today);
  const next: LifeSchedule = {
    ...schedule,
    tutorId,
    generatedAt: now,
    coversUntil: addDays(start, days),
    events: [...kept, ...events].sort((a, b) => a.startDate.localeCompare(b.startDate)).slice(-MAX_EVENTS * 2),
  };
  saveSchedule(next);
  return next;
}

export function eventsOn(schedule: LifeSchedule, date = todayStr()): LifeEvent[] {
  return schedule.events.filter((event) => event.startDate <= date && event.endDate >= date);
}

/** 오늘의 대표 이벤트 — 여행이 있으면 여행이 항상 우선한다. */
export function currentEvent(schedule: LifeSchedule, date = todayStr()): LifeEvent | null {
  const today = eventsOn(schedule, date);
  if (today.length === 0) return null;
  return today.find((event) => event.kind === "travel") ?? today[0];
}

export interface LifeStatus {
  event: LifeEvent | null;
  travelling: boolean;
  city: string;
  timezone: string;
}

export function lifeStatus(tutorId: string, date = todayStr()): LifeStatus {
  const persona = getPersona(tutorId);
  const event = currentEvent(getSchedule(tutorId), date);
  const travelling = event?.kind === "travel";
  return {
    event,
    travelling,
    city: travelling ? event!.city : persona.life.homeCity,
    timezone: travelling ? event!.timezone : persona.rhythm.timezone,
  };
}

/** 프롬프트에 주입할 "지금 나는 어디에서 무엇을 하는 중" 블록. */
export function lifeContext(tutorId: string, date = todayStr()): string {
  const persona = getPersona(tutorId);
  const schedule = getSchedule(tutorId);
  const today = eventsOn(schedule, date);
  if (today.length === 0) {
    return `지금 ${persona.life.homeCity}에서 평소와 다름없는 하루를 보내는 중입니다.`;
  }
  const lines = today.map((event) =>
    event.kind === "travel"
      ? `- [여행 중] ${event.city}: ${event.detail} (${event.startDate} ~ ${event.endDate})`
      : `- ${event.title}: ${event.detail}`,
  );
  const primary = currentEvent(schedule, date);
  const header =
    primary?.kind === "travel"
      ? `지금 당신은 ${primary.city}에 여행 중입니다. 집(${persona.life.homeCity})에 있지 않습니다.`
      : `지금 당신은 ${persona.life.homeCity}에 있습니다.`;
  return `${header}\n${lines.join("\n")}`;
}

// ── 사진 메시지 ──

export interface LifePost {
  text: string;
  ko: string;
  teachFocus: string;
  photo: ChatPhoto;
  event: LifeEvent;
}

function pickKeyword(event: LifeEvent, persona: TutorPersona, used: string[]): string {
  const pool = event.photoKeywords.length > 0 ? event.photoKeywords : persona.life.photoKeywords.daily;
  if (pool.length === 0) return persona.life.homeCity;
  // 같은 이벤트에서 여러 장을 보낼 때 키워드가 겹치지 않게 순회한다.
  return pool[used.length % pool.length];
}

/** 오늘 이 튜터가 사진을 보낼 수 있는지 (하루 1장으로 제한). */
export function canPostToday(schedule: LifeSchedule, date = todayStr()): boolean {
  if (schedule.lastPostedDate !== date) return true;
  return schedule.postsToday < 1;
}

/**
 * 오늘의 일정에 맞는 사진 + 학습자에게 던지는 질문을 만든다.
 * 실패하면 null — 호출자는 그냥 이번 tick을 넘긴다.
 */
export async function composeLifePost(
  tutorId: string,
  context: { learnerName: string; level: number; intimacy: number; intimacyTone: string; memory: string },
  date = todayStr(),
): Promise<LifePost | null> {
  const schedule = await ensureSchedule(tutorId);
  if (!canPostToday(schedule, date)) return null;
  const event = currentEvent(schedule, date);
  if (!event) return null;

  const persona = getPersona(tutorId);
  const keyword = pickKeyword(event, persona, schedule.usedPhotos);
  const photo = await fetchPhoto(keyword, { used: schedule.usedPhotos });

  let text = "";
  let ko = "";
  let teachFocus = "";
  try {
    const system = loadPrompt("life-post", {
      name: persona.name,
      learnerName: context.learnerName || "친구",
      lifeContext: lifeContext(tutorId, date),
      photoAlt: escapePromptData(photo.alt),
      photoKeyword: keyword,
      intimacy: String(context.intimacy),
      intimacyTone: context.intimacyTone,
      level: String(context.level),
      memory: context.memory,
    });
    const result = await chatLLM({
      system,
      messages: [{ role: "user", content: "사진과 함께 보낼 메시지를 만들어 주세요." }],
      maxTokens: 400,
      feature: "life-post",
    });
    const parsed = parseJsonLoose<{ text?: string; ko?: string; teachFocus?: string }>(result.text);
    text = parsed?.text?.trim() ?? "";
    ko = parsed?.ko?.trim() ?? "";
    teachFocus = parsed?.teachFocus?.trim() ?? "";
  } catch (error) {
    console.error("[life] post generation failed:", error);
  }

  if (!text) return null;

  const updated = getSchedule(tutorId);
  const target = updated.events.find((item) => item.id === event.id);
  if (target) target.posts += 1;
  updated.usedPhotos.push(photo.url);
  updated.postsToday = updated.lastPostedDate === date ? updated.postsToday + 1 : 1;
  updated.lastPostedDate = date;
  saveSchedule(updated);

  return { text, ko, teachFocus, photo, event };
}

export const LIFE_CONSTANTS = { HORIZON_DAYS, REFRESH_THRESHOLD_DAYS, MAX_EVENTS };
