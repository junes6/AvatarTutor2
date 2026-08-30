// 친구의 생활 리듬 — 타임존별 활동 시간대와 "사람처럼 뜸 들이는" 응답 지연 계산.
// 순수 함수만 있어 단독으로 테스트할 수 있다 (scripts/regression-async-chat.ts).

import type { PersonaRhythm } from "./types";

export interface DelayPlan {
  /** 메시지가 채팅방에 나타나는 시각 */
  dueAt: number;
  /** "입력 중…"을 켜기 시작할 시각 — 항상 dueAt의 후반부 */
  typingFrom: number;
  /** 자는 동안 받은 메시지라 다음 활동 시간대로 미뤄졌는지 */
  sleptThrough: boolean;
  band: "instant" | "short" | "normal" | "long";
}

export interface DelayInput {
  rhythm: PersonaRhythm;
  /** 튜터가 보낼 문장 — 길이로 지연 구간을 정한다 */
  text: string;
  /** "지금 대화 중" 토글이 켜져 있으면 지연 없이 즉시 */
  live?: boolean;
  /** 여행 중이면 관광하느라 답이 늦는다 */
  travelling?: boolean;
  /** 여행 중 임시 타임존 (없으면 rhythm.timezone) */
  timezone?: string;
  now?: number;
  /** 테스트에서 지터를 고정하기 위한 주입점 */
  random?: () => number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 지연 구간 (초). 기획서의 3~8 / 10~25 / 25~45초를 그대로 쓴다. */
const BANDS = {
  short: [3, 8],
  normal: [10, 25],
  long: [25, 45],
} as const;

function safeTimezone(timezone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return timezone;
  } catch {
    // 잘못된 IANA 이름 때문에 채팅 전체가 죽지 않게 UTC로 낮춘다.
    return "UTC";
  }
}

const hourFormatters = new Map<string, Intl.DateTimeFormat>();

function hourFormatter(timezone: string): Intl.DateTimeFormat {
  const zone = safeTimezone(timezone);
  let formatter = hourFormatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    hourFormatters.set(zone, formatter);
  }
  return formatter;
}

/** 해당 타임존의 현지 시각을 0~24 사이 실수(시)로 반환한다. */
export function localHour(timezone: string, at = Date.now()): number {
  const parts = hourFormatter(timezone).formatToParts(new Date(at));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return hour + minute / 60;
}

/** 현지 시각 문자열 (채팅방 헤더의 "런던 오후 3:20"용) */
export function localTimeLabel(timezone: string, at = Date.now()): string {
  try {
    return new Intl.DateTimeFormat("ko-KR", {
      timeZone: safeTimezone(timezone),
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(at));
  } catch {
    return "";
  }
}

/** wakeHour ≤ h < sleepHour (자정을 넘기면 랩어라운드) */
export function isAwake(rhythm: PersonaRhythm, at = Date.now(), timezone = rhythm.timezone): boolean {
  const hour = localHour(timezone, at);
  const { wakeHour, sleepHour } = rhythm;
  if (wakeHour === sleepHour) return true;
  return sleepHour > wakeHour
    ? hour >= wakeHour && hour < sleepHour
    : hour >= wakeHour || hour < sleepHour;
}

/** 지금 자고 있다면 다음 기상 시각(epoch ms), 깨어 있으면 now를 돌려준다. */
export function nextAwakeAt(rhythm: PersonaRhythm, at = Date.now(), timezone = rhythm.timezone): number {
  if (isAwake(rhythm, at, timezone)) return at;
  const hour = localHour(timezone, at);
  // 기상까지 남은 현지 시간(시). 자정을 넘어가는 경우도 모듈러로 처리된다.
  const hoursUntilWake = (rhythm.wakeHour - hour + 24) % 24;
  return at + Math.max(0, hoursUntilWake) * HOUR;
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function isReactionOnly(text: string): boolean {
  const stripped = text.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\s!?.~,ㅋㅎ]/gu, "");
  if (!stripped) return true;
  return wordCount(text) <= 3 && !/[.?!]\s+\S/.test(text);
}

export function classifyBand(text: string): "short" | "normal" | "long" {
  if (isReactionOnly(text)) return "short";
  const words = wordCount(text);
  if (words <= 18) return "normal";
  return "long";
}

/**
 * "입력 중…"은 지연 구간의 후반부에만 뜬다. 답이 길수록 타이핑도 오래 걸리는
 * 것처럼 보이되, 전체 지연의 60%를 넘지 않게 해서 뜸 들이는 앞부분을 남긴다.
 */
export function typingDurationMs(text: string, totalDelayMs: number): number {
  const words = wordCount(text);
  const estimate = 1_200 + words * 320;
  return Math.max(900, Math.min(estimate, Math.round(totalDelayMs * 0.6)));
}

export function planDelivery(input: DelayInput): DelayPlan {
  const now = input.now ?? Date.now();
  const random = input.random ?? Math.random;
  const timezone = input.timezone ?? input.rhythm.timezone;

  if (input.live) {
    return { dueAt: now, typingFrom: now, sleptThrough: false, band: "instant" };
  }

  const band = classifyBand(input.text);
  const [minSec, maxSec] = BANDS[band];
  const jitter = minSec + random() * (maxSec - minSec);
  const speed = Number.isFinite(input.rhythm.replySpeed) ? input.rhythm.replySpeed : 1;
  const travelMultiplier = input.travelling ? 1.6 : 1;
  const baseDelay = Math.round(jitter * 1_000 * speed * travelMultiplier);

  const awake = isAwake(input.rhythm, now, timezone);
  if (awake) {
    const dueAt = now + baseDelay;
    return {
      dueAt,
      typingFrom: dueAt - typingDurationMs(input.text, baseDelay),
      sleptThrough: false,
      band,
    };
  }

  // 자는 동안 온 메시지는 다음 활동 시간대에 몰아서 답한다. 정각에 칼같이
  // 답하면 봇처럼 보이므로 기상 후 0~35분 사이로 흩뜨린다.
  const wake = nextAwakeAt(input.rhythm, now, timezone);
  const dueAt = wake + Math.round(random() * 35 * MINUTE);
  return {
    dueAt,
    typingFrom: dueAt - typingDurationMs(input.text, 20_000),
    sleptThrough: true,
    band,
  };
}

/** 자고 일어나 몰아서 답할 때 튜터에게 주입할 한 줄 지침. */
export function sleepApologyHint(rhythm: PersonaRhythm, sleptMs: number): string {
  const hours = Math.max(1, Math.round(sleptMs / HOUR));
  return `당신은 방금까지 자고 있었고 학습자의 메시지를 약 ${hours}시간 만에 확인했습니다. 첫 문장에서 자연스럽게 늦은 이유를 가볍게 언급하고("just woke up", "sorry, I was asleep") 바로 본론으로 이어가세요. 사과를 길게 하지 마세요.`;
}

/** 여행 중일 때 주입할 지연 사유. */
export function travelDelayHint(city: string): string {
  return `당신은 지금 ${city}에 여행 중이라 하루 종일 돌아다니고 있습니다. 답이 늦어진 것을 한 번만 가볍게 언급해도 좋습니다.`;
}

export const RHYTHM_CONSTANTS = { MINUTE, HOUR, DAY, BANDS };
