// 비동기 발송 큐 — 튜터 답장을 즉시 반환하지 않고 예약해 두었다가 도착시킨다.
// 저장소에만 의존하므로 서버 라우트 없이 단독 테스트할 수 있다.

import { readJSON, writeJSON, uid } from "./store";
import { appendMessages } from "./chatStore";
import { sendPush } from "./push";
import type { ChatMessage, DeliveryQueue, DeliveryReason, ScheduledMessage } from "./types";

const QUEUE_FILE = "delivery";
const EMPTY: DeliveryQueue = { pending: [] };
/** 서버가 오래 꺼져 있었다면 몇 시간 묵은 답장을 한꺼번에 쏟지 않는다. */
const MAX_STALE_MS = 6 * 60 * 60_000;

function load(): DeliveryQueue {
  const queue = readJSON<DeliveryQueue>(QUEUE_FILE, EMPTY);
  if (!Array.isArray(queue.pending)) return { pending: [] };
  return queue;
}

function save(queue: DeliveryQueue) {
  writeJSON(QUEUE_FILE, queue);
}

export interface ScheduleInput {
  tutorId: string;
  message: ChatMessage;
  dueAt: number;
  typingFrom: number;
  reason: DeliveryReason;
  push?: { title: string; body: string; url: string } | null;
}

export function schedule(input: ScheduleInput): ScheduledMessage {
  const entry: ScheduledMessage = {
    id: uid("d"),
    tutorId: input.tutorId,
    dueAt: input.dueAt,
    typingFrom: Math.min(input.typingFrom, input.dueAt),
    createdAt: Date.now(),
    reason: input.reason,
    message: { ...input.message, composedAt: Date.now() },
    push: input.push ?? null,
  };
  const queue = load();
  queue.pending.push(entry);
  queue.pending.sort((a, b) => a.dueAt - b.dueAt);
  save(queue);
  return entry;
}

export function pendingFor(tutorId: string): ScheduledMessage[] {
  return load().pending.filter((entry) => entry.tutorId === tutorId);
}

export function pendingCount(): number {
  return load().pending.length;
}

export interface TypingStatus {
  /** 지금 "입력 중…"을 보여야 하는가 */
  typing: boolean;
  /** 다음 메시지 도착 예정 시각 (없으면 null) */
  nextAt: number | null;
}

export function typingStatus(tutorId: string, now = Date.now()): TypingStatus {
  const pending = pendingFor(tutorId);
  if (pending.length === 0) return { typing: false, nextAt: null };
  const next = pending.reduce((a, b) => (a.dueAt <= b.dueAt ? a : b));
  return { typing: now >= next.typingFrom, nextAt: next.dueAt };
}

/**
 * due가 된 메시지를 채팅방에 도착시킨다. 라우트/스케줄러 tick에서 호출한다.
 * 반환값은 실제로 도착한 메시지들 — 호출자가 사운드/뱃지 갱신에 쓴다.
 */
export async function flushDue(now = Date.now()): Promise<ScheduledMessage[]> {
  const queue = load();
  if (queue.pending.length === 0) return [];

  const due = queue.pending.filter((entry) => entry.dueAt <= now);
  if (due.length === 0) return [];
  queue.pending = queue.pending.filter((entry) => entry.dueAt > now);
  save(queue);

  const delivered: ScheduledMessage[] = [];
  for (const entry of due) {
    // 서버가 꺼져 있던 사이 밀린 답장은 "방금 도착한 것처럼" 시각을 당긴다.
    const stale = now - entry.dueAt > MAX_STALE_MS;
    const message: ChatMessage = { ...entry.message, ts: stale ? now : Math.max(entry.dueAt, entry.message.ts) };
    try {
      appendMessages(entry.tutorId, message);
      delivered.push({ ...entry, message });
    } catch (error) {
      console.error("[delivery] append failed", entry.id, error);
      continue;
    }
    if (entry.push) {
      try {
        await sendPush(entry.push.title, entry.push.body, entry.push.url);
      } catch (error) {
        console.error("[delivery] push failed", entry.id, error);
      }
    }
  }
  return delivered;
}

/** "지금 대화 중"을 켰을 때 밀린 답장을 즉시 도착시킨다. */
export async function flushTutor(tutorId: string): Promise<ScheduledMessage[]> {
  const queue = load();
  const mine = queue.pending.filter((entry) => entry.tutorId === tutorId);
  if (mine.length === 0) return [];
  queue.pending = queue.pending.filter((entry) => entry.tutorId !== tutorId);
  save(queue);

  const now = Date.now();
  const delivered: ScheduledMessage[] = [];
  for (const entry of mine.sort((a, b) => a.dueAt - b.dueAt)) {
    const message: ChatMessage = { ...entry.message, ts: now };
    appendMessages(tutorId, message);
    delivered.push({ ...entry, message });
  }
  return delivered;
}

/** 친구를 떠나보내면 그 친구의 예약 메시지도 사라져야 한다. */
export function cancelTutor(tutorId: string): number {
  const queue = load();
  const before = queue.pending.length;
  queue.pending = queue.pending.filter((entry) => entry.tutorId !== tutorId);
  if (queue.pending.length !== before) save(queue);
  return before - queue.pending.length;
}

export function clearQueue() {
  save({ pending: [] });
}
