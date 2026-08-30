// 채팅 API — 메시지 조회 / 전송 / 읽음 / 리액션 / "지금 대화 중" 토글.

import { NextResponse } from "next/server";
import { chatTurn } from "@/core/chat";
import {
  getChat,
  isLive,
  markRead,
  setLive,
  toggleReaction,
} from "@/core/chatStore";
import { typingStatus } from "@/core/deliveryQueue";
import { flushTutor } from "@/core/deliveryQueue";
import { drainDeliveries } from "@/core/proactive";
import { getPersona } from "@/core/content";
import { isActiveFriend } from "@/core/friends";
import { peekHealth } from "@/core/health";

const MAX_CHAT_LENGTH = 2_000;
const MAX_JSON_BYTES = 16 * 1024;
const ALLOWED_REACTIONS = ["❤️", "😂", "👍", "😮", "😢", "🔥"];

function privateJson(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "private, no-store");
  return NextResponse.json(data, { ...init, headers });
}

function validTutor(tutorId: unknown): tutorId is string {
  if (typeof tutorId !== "string" || !tutorId) return false;
  try {
    getPersona(tutorId);
    return true;
  } catch {
    return false;
  }
}

export async function GET(req: Request) {
  const tutorId = new URL(req.url).searchParams.get("tutorId");
  if (!validTutor(tutorId)) return privateJson({ error: "invalid tutorId" }, { status: 400 });

  // 폴링 시점마다 도착 예정 메시지를 먼저 떨어뜨린다 — 앱을 열어 두면 알림 없이도 대화가 이어진다.
  await drainDeliveries();

  const thread = getChat(tutorId);
  const persona = getPersona(tutorId);
  return privateJson({
    messages: thread.messages,
    live: isLive(tutorId),
    liveUntil: thread.liveUntil ?? null,
    typing: typingStatus(tutorId),
    tutor: {
      id: persona.id,
      koName: persona.koName,
      name: persona.name,
      emoji: persona.emoji,
      color: persona.color,
      profileImage: persona.profileImage,
      timezone: persona.rhythm.timezone,
    },
    active: isActiveFriend(tutorId),
    demo: peekHealth()?.demo ?? null,
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
    const { tutorId } = body as { tutorId: string };
    if (!validTutor(tutorId)) {
      return privateJson({ error: "invalid tutorId" }, { status: 400 });
    }

    switch (body.action) {
      case "read": {
        markRead(tutorId);
        return privateJson({ ok: true });
      }
      case "react": {
        const messageId = String(body.messageId ?? "");
        const emoji = String(body.emoji ?? "");
        if (!messageId || !ALLOWED_REACTIONS.includes(emoji)) {
          return privateJson({ error: "invalid reaction" }, { status: 400 });
        }
        const message = toggleReaction(tutorId, messageId, emoji);
        if (!message) return privateJson({ error: "message not found" }, { status: 404 });
        return privateJson({ ok: true, message });
      }
      case "live": {
        const on = body.on !== false;
        const liveUntil = setLive(tutorId, on);
        // 켜는 순간 밀려 있던 답장을 바로 도착시킨다.
        const delivered = on ? await flushTutor(tutorId) : [];
        return privateJson({ ok: true, live: on, liveUntil: liveUntil ?? null, delivered: delivered.length });
      }
      default:
        break;
    }

    const text = String(body.text ?? "").trim();
    if (!text) return privateJson({ error: "text required" }, { status: 400 });
    if (text.length > MAX_CHAT_LENGTH) {
      return privateJson({ error: `text must be ${MAX_CHAT_LENGTH} characters or fewer` }, { status: 400 });
    }
    const replyToId = typeof body.replyToId === "string" ? body.replyToId : undefined;
    const result = await chatTurn({ tutorId, text, replyToId, signal: req.signal });
    return privateJson(result);
  } catch (e) {
    if (e instanceof SyntaxError) return privateJson({ error: "invalid JSON" }, { status: 400 });
    console.error("[api/chat]", e);
    return privateJson({ error: "chat request failed" }, { status: 500 });
  }
}
