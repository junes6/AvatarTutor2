// 채팅 스레드 저장소 — 메시지 append/읽음/리액션/"지금 대화 중" 토글.
// 턴 처리(chat.ts)와 지연 큐(deliveryQueue.ts)가 서로를 import하지 않도록
// 순수 저장 계층만 여기에 둔다.

import { readJSON, writeJSON, uid } from "./store";
import { config } from "./config";
import type { ChatMessage, ChatReaction, ChatThread } from "./types";

const MAX_MESSAGES = 800;

export function chatKey(tutorId: string, conversationId?: string): string {
  if (conversationId === undefined) return tutorId;
  const external = conversationId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "external-anonymous";
  return `${tutorId}-${external}`;
}

export function getChat(key: string): ChatThread {
  const thread = readJSON<ChatThread>(`chats/${key}`, { messages: [] });
  if (!Array.isArray(thread.messages)) thread.messages = [];
  return thread;
}

export function saveChat(key: string, data: ChatThread) {
  if (data.messages.length > MAX_MESSAGES) data.messages = data.messages.slice(-MAX_MESSAGES);
  writeJSON(`chats/${key}`, data);
}

/** 최신 스냅샷에 원자적으로 append — 지연 큐/능동 메시지와의 경합을 막는다. */
export function appendMessages(key: string, ...messages: ChatMessage[]): ChatThread {
  const thread = getChat(key);
  thread.messages.push(...messages);
  saveChat(key, thread);
  return thread;
}

export function newMessage(partial: Partial<ChatMessage> & Pick<ChatMessage, "role" | "text">): ChatMessage {
  return {
    id: uid("m"),
    kind: "text",
    ts: Date.now(),
    read: partial.role === "user",
    ...partial,
  };
}

export function markRead(key: string): number {
  const thread = getChat(key);
  let changed = 0;
  for (const message of thread.messages) {
    if (!message.read) {
      message.read = true;
      changed++;
    }
  }
  if (changed > 0) saveChat(key, thread);
  return changed;
}

export function unreadCount(key: string): number {
  return getChat(key).messages.filter((message) => !message.read && message.role === "tutor").length;
}

export function findMessage(key: string, messageId: string): ChatMessage | undefined {
  return getChat(key).messages.find((message) => message.id === messageId);
}

/** 롱프레스 이모지 반응 — 같은 이모지를 다시 누르면 토글로 해제된다. */
export function toggleReaction(key: string, messageId: string, emoji: string, by: ChatReaction["by"] = "user"): ChatMessage | null {
  const thread = getChat(key);
  const message = thread.messages.find((item) => item.id === messageId);
  if (!message) return null;
  const reactions = message.reactions ?? [];
  const existing = reactions.findIndex((reaction) => reaction.emoji === emoji && reaction.by === by);
  if (existing >= 0) reactions.splice(existing, 1);
  else reactions.push({ emoji, by, ts: Date.now() });
  message.reactions = reactions.length > 0 ? reactions : undefined;
  saveChat(key, thread);
  return message;
}

// ── "지금 대화 중" 토글 ──
// 켜면 지연 큐를 건너뛰고 즉시 응답한다. 마지막 입력에서 5분이 지나면 자동 해제.

export function isLive(key: string, now = Date.now()): boolean {
  const until = getChat(key).liveUntil;
  return typeof until === "number" && until > now;
}

export function setLive(key: string, on: boolean, now = Date.now()): number | undefined {
  const thread = getChat(key);
  thread.liveUntil = on ? now + config.chat.liveWindowMs : undefined;
  saveChat(key, thread);
  return thread.liveUntil;
}

/** 입력이 있을 때마다 만료 시각을 밀어 준다 (켜져 있을 때만). */
export function touchLive(key: string, now = Date.now()): number | undefined {
  const thread = getChat(key);
  if (typeof thread.liveUntil !== "number" || thread.liveUntil <= now) return undefined;
  thread.liveUntil = now + config.chat.liveWindowMs;
  saveChat(key, thread);
  return thread.liveUntil;
}

export function lastMessage(key: string): ChatMessage | null {
  const messages = getChat(key).messages;
  return messages.length > 0 ? messages[messages.length - 1] : null;
}

/** 채팅 목록 미리보기 — 사진/음성/통화 요약도 한 줄로 읽히게 만든다. */
export function previewText(message: ChatMessage | null): string {
  if (!message) return "";
  switch (message.kind) {
    case "photo":
      return message.text ? `📷 ${message.text}` : "📷 사진";
    case "voice":
      return "🎙️ 음성 메시지";
    case "call-summary":
      return "📞 통화 요약";
    default:
      return message.text;
  }
}
