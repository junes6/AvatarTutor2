// 채팅 채널 — 메신저 대화 저장 + 채팅 턴 처리 (+ 주기적 기억 요약)

import { readJSON, writeJSON, uid } from "./store";
import { runTurn } from "./pipeline/turn";
import { summarizeToMemory, chatToTranscript } from "./memory";
import type { ChatMessage, SessionRecord, CorrectionCard, ProactiveType } from "./types";

export function getChat(tutorId: string): { messages: ChatMessage[] } {
  return readJSON(`chats/${tutorId}`, { messages: [] as ChatMessage[] });
}

export function saveChat(tutorId: string, data: { messages: ChatMessage[] }) {
  // 채팅은 최근 500개 유지
  if (data.messages.length > 500) data.messages = data.messages.slice(-500);
  writeJSON(`chats/${tutorId}`, data);
}

export function appendTutorMessage(
  tutorId: string,
  text: string,
  ko: string,
  proactiveType?: ProactiveType,
): ChatMessage {
  const chat = getChat(tutorId);
  const msg: ChatMessage = { id: uid("m"), role: "tutor", text, ko, ts: Date.now(), read: false, proactiveType };
  chat.messages.push(msg);
  saveChat(tutorId, chat);
  return msg;
}

export function markRead(tutorId: string) {
  const chat = getChat(tutorId);
  let changed = false;
  for (const m of chat.messages) {
    if (!m.read) {
      m.read = true;
      changed = true;
    }
  }
  if (changed) saveChat(tutorId, chat);
}

export async function chatTurn(
  tutorId: string,
  userText: string,
): Promise<{ userMsg: ChatMessage; tutorMsg: ChatMessage; correction: CorrectionCard | null }> {
  const chat = getChat(tutorId);

  // 파이프라인 재사용을 위한 의사(pseudo) 세션 — 히스토리는 채팅에서 가져온다
  const pseudo: SessionRecord = {
    id: "chat-" + tutorId,
    tutorId,
    mode: "chat",
    startedAt: Date.now(),
    turns: chat.messages.slice(-24).map((m) => ({
      id: m.id,
      role: m.role,
      text: m.text,
      ts: m.ts,
    })),
    corrections: [],
    judgments: [],
    xpEarned: 0,
    pronunciationScores: [],
  };

  const result = await runTurn({ session: pseudo, userText });

  const userMsg: ChatMessage = {
    id: uid("m"),
    role: "user",
    text: userText,
    correction: result.correction,
    ts: Date.now(),
    read: true,
  };
  const tutorMsg: ChatMessage = {
    id: uid("m"),
    role: "tutor",
    text: result.reply,
    ko: result.reply_ko,
    ts: Date.now(),
    read: true,
  };
  chat.messages.push(userMsg, tutorMsg);
  saveChat(tutorId, chat);

  // 대화가 쌓이면 주기적으로 기억 요약 (12개 메시지마다)
  if (chat.messages.length % 12 === 0) {
    summarizeToMemory(tutorId, chatToTranscript(chat.messages.slice(-20))).catch(() => {});
  }

  return { userMsg, tutorMsg, correction: result.correction };
}
