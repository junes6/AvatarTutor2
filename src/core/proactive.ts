// 능동 시스템 — 친구가 먼저 말을 건다.
// 클라이언트/크론이 /api/tick 을 호출하면 (1) 예약 도착 (2) 새 친구 소개
// (3) 라이프 사진 (4) 능동 메시지 순서로 최대 1건씩 처리한다.

import { readJSON, writeJSON, todayStr } from "./store";
import { loadPrompt } from "./prompts";
import { chatLLM } from "./llm";
import { parseJsonLoose } from "./pipeline/parse";
import { escapePromptData } from "./pipeline/systemPrompt";
import { getPersona, getPersonas } from "./content";
import { getUser, getTutorState, intimacyLevel } from "./gamification";
import { getDueItems } from "./srs";
import { findExpression } from "./content";
import { appendTutorMessage, personaContext } from "./chat";
import { getChat, newMessage, previewText } from "./chatStore";
import { activeFriends, breakStreak, completeIntro, dueIntro, learnerProfile, getRoster } from "./friends";
import { composeLifePost, ensureSchedule, lifeContext, lifeStatus } from "./life";
import { schedule, flushDue } from "./deliveryQueue";
import { isAwake, planDelivery } from "./rhythm";
import { buildVoiceNote, suitsVoice } from "./voiceNote";
import { GOALS, interestLabel, OCCUPATIONS } from "./tags";
import { sendPush } from "./push";
import type { ChatMessage, ProactiveType, ScheduledMessage } from "./types";

interface ProactiveState {
  date: string;
  sentToday: number;
  lastMorning: string;
  lastQuiz: string;
  lastCheckin: string;
  lastMissyou: string;
  lastLife: string;
  rotation: number;
}

const DEFAULT_STATE: ProactiveState = {
  date: "",
  sentToday: 0,
  lastMorning: "",
  lastQuiz: "",
  lastCheckin: "",
  lastMissyou: "",
  lastLife: "",
  rotation: 0,
};

/** 학습자를 새벽에 깨우지 않는다 — 튜터가 깨어 있어도 이 창 안에서만 보낸다. */
const LEARNER_QUIET_START = 8;
const LEARNER_QUIET_END = 23;
/** 음성 메시지 비중 — 매번 음성이면 피곤하다. */
const VOICE_CHANCE = 0.22;

function loadState(): ProactiveState {
  const state = readJSON<ProactiveState>("proactive", DEFAULT_STATE);
  const today = todayStr();
  if (state.date !== today) {
    return { ...state, date: today, sentToday: 0 };
  }
  return state;
}

function saveState(state: ProactiveState) {
  writeJSON("proactive", state);
}

function withinLearnerWindow(now = new Date()): boolean {
  const hour = now.getHours();
  return hour >= LEARNER_QUIET_START && hour < LEARNER_QUIET_END;
}

/** 지금 메시지를 보낼 수 있는 (=깨어 있는) 활성 친구들. */
function availableTutors(): string[] {
  return activeFriends()
    .map((friend) => friend.tutorId)
    .filter((tutorId) => {
      try {
        const persona = getPersona(tutorId);
        const status = lifeStatus(tutorId);
        return isAwake(persona.rhythm, Date.now(), status.timezone);
      } catch {
        return false;
      }
    });
}

function pickTutor(candidates: string[], rotation: number): string | null {
  if (candidates.length === 0) return null;
  // 친밀도 높은 친구에 가중치를 주되 로테이션으로 다양성을 확보한다.
  const sorted = [...candidates].sort((a, b) => getTutorState(b).intimacyXp - getTutorState(a).intimacyXp);
  return sorted[rotation % sorted.length];
}

/** 튜터 메시지를 리듬에 맞춰 예약한다 (능동 메시지도 즉시 도착하지 않는다). */
function deliverLater(tutorId: string, message: ChatMessage, reason: ScheduledMessage["reason"]) {
  const persona = getPersona(tutorId);
  const status = lifeStatus(tutorId);
  const plan = planDelivery({
    rhythm: persona.rhythm,
    text: message.text,
    timezone: status.timezone,
    travelling: status.travelling,
  });
  schedule({
    tutorId,
    message,
    dueAt: plan.dueAt,
    typingFrom: plan.typingFrom,
    reason,
    push: { title: persona.koName, body: previewText(message).slice(0, 120), url: `/chat/${tutorId}` },
  });
  return plan;
}

// ── 1. 새 친구 소개 ──

async function sendIntro(): Promise<ProactiveType | null> {
  const pending = dueIntro();
  if (!pending) return null;

  const persona = getPersona(pending.tutorId);
  const user = getUser();
  const profile = learnerProfile();
  const introducer = pending.introducedBy
    ? (() => {
        const source = getPersona(pending.introducedBy!);
        return `${source.name}(${source.koName}) — ${source.job}, ${source.nationality}. 이 사람이 학습자를 소개해 줬습니다.`;
      })()
    : "특정한 소개자는 없습니다. '친구한테 얘기 들었어' 정도로만 언급하세요.";

  const system = loadPrompt("friend-intro", {
    name: persona.name,
    age: String(persona.age),
    job: escapePromptData(persona.job),
    nationality: escapePromptData(persona.nationality),
    personality: escapePromptData(persona.personality),
    speakingStyle: escapePromptData(persona.speakingStyle),
    myInterests: escapePromptData(persona.interests.join(", ")),
    lifeContext: escapePromptData(lifeContext(pending.tutorId)),
    learnerName: user.name || "친구",
    introducer: escapePromptData(introducer),
    interests: profile.interests.map(interestLabel).join(", "),
    occupation: OCCUPATIONS.find((item) => item.id === profile.occupation)?.label ?? "알 수 없음",
    ageBand: profile.ageBand,
    goal: GOALS.find((item) => item.id === profile.goal)?.label ?? "취미",
    level: String(user.level),
  });

  try {
    const result = await chatLLM({
      system,
      messages: [{ role: "user", content: "첫 메시지를 만들어 주세요." }],
      maxTokens: 500,
      feature: "friend-intro",
    });
    const parsed = parseJsonLoose<{ text?: string; ko?: string }>(result.text);
    const text = parsed?.text?.trim();
    if (!text) return null;

    completeIntro(pending.tutorId);
    const message = newMessage({
      role: "tutor",
      text,
      ko: parsed?.ko ?? "",
      read: false,
      proactiveType: "intro",
    });
    // 소개는 기다리게 하지 않는다 — 짧은 지연 후 바로 도착시킨다.
    schedule({
      tutorId: pending.tutorId,
      message,
      dueAt: Date.now() + 4_000,
      typingFrom: Date.now() + 1_500,
      reason: "intro",
      push: {
        title: `${persona.koName}님이 대화를 시작했어요`,
        body: text.slice(0, 120),
        url: `/chat/${pending.tutorId}`,
      },
    });
    return "intro";
  } catch (error) {
    console.error("[proactive] intro failed:", error);
    return null;
  }
}

// ── 2. 라이프 사진 메시지 ──

async function sendLifePost(state: ProactiveState, candidates: string[]): Promise<ProactiveType | null> {
  const today = todayStr();
  if (state.lastLife === today) return null;
  const tutorId = pickTutor(candidates, state.rotation + 1);
  if (!tutorId) return null;

  const context = personaContext(tutorId);
  const post = await composeLifePost(tutorId, {
    learnerName: context.learnerName,
    level: context.level,
    intimacy: context.intimacy,
    intimacyTone: context.intimacyTone,
    memory: context.memory,
  });
  if (!post) return null;

  const message = newMessage({
    role: "tutor",
    kind: "photo",
    text: post.text,
    ko: post.ko,
    photo: {
      ...post.photo,
      // 사진을 눌러 그 장면으로 즉석 롤플레이를 열 수 있게 시나리오를 붙인다.
      roleplayScenarioId: scenarioForPhoto(post.teachFocus, post.photo.alt),
    },
    read: false,
    proactiveType: "life",
  });
  deliverLater(tutorId, message, "life");
  state.lastLife = today;
  return "life";
}

/** 사진 소재 → 어울리는 롤플레이 시나리오. 없으면 undefined. */
export function scenarioForPhoto(teachFocus: string, alt: string): string | undefined {
  const haystack = `${teachFocus} ${alt}`.toLowerCase();
  if (/주문|메뉴|식당|restaurant|menu|order|dish|plate|food|dinner/.test(haystack)) return "restaurant";
  if (/카페|커피|cafe|coffee|latte|brunch/.test(haystack)) return "cafe";
  if (/호텔|숙소|hotel|check-?in|room/.test(haystack)) return "hotel";
  if (/공항|비행|airport|flight|boarding/.test(haystack)) return "airport";
  if (/쇼핑|shop|store|market|buy|price/.test(haystack)) return "shopping";
  return undefined;
}

// ── 3. 일반 능동 메시지 ──

async function generate(tutorId: string, type: ProactiveType): Promise<ProactiveType | null> {
  const persona = getPersona(tutorId);
  const context = personaContext(tutorId);

  let quizExpression = "";
  let quizExpressionKo = "";
  if (type === "quiz") {
    const due = getDueItems(1)[0];
    if (!due) return null;
    const found = findExpression(due.expressionId);
    if (!found) return null;
    quizExpression = found.expr.en;
    quizExpressionKo = found.expr.ko;
  }

  const system = loadPrompt("proactive-message", {
    name: persona.name,
    learnerName: context.learnerName,
    level: String(context.level),
    intimacy: String(context.intimacy),
    intimacyTone: context.intimacyTone,
    memory: context.memory,
    lifeContext: escapePromptData(lifeContext(tutorId)),
    proactiveType: type,
    quizExpression,
    quizExpressionKo,
  });

  try {
    const result = await chatLLM({
      system,
      messages: [{ role: "user", content: "메시지를 생성해 주세요." }],
      maxTokens: 400,
      feature: "proactive",
    });
    const parsed = parseJsonLoose<{ text?: string; ko?: string }>(result.text);
    const text = parsed?.text?.trim();
    if (!text) return null;

    // 가끔은 음성 메시지로 — 듣기 노출을 자연스럽게 늘린다.
    const asVoice = type !== "quiz" && suitsVoice(text) && Math.random() < VOICE_CHANCE;
    const message = newMessage({
      role: "tutor",
      kind: asVoice ? "voice" : "text",
      text,
      ko: parsed?.ko ?? "",
      voice: asVoice ? buildVoiceNote(text, parsed?.ko) : null,
      read: false,
      proactiveType: type,
    });
    deliverLater(tutorId, message, asVoice ? "voice" : "proactive");
    // 튜터가 먼저 보냈으니 연속 턴은 학습자의 답으로 다시 시작한다.
    breakStreak(tutorId);
    return type;
  } catch (error) {
    console.error("[proactive] generate failed:", error);
    return null;
  }
}

export interface TickResult {
  delivered: number;
  generated: ProactiveType | null;
  pendingIntroAt: number | null;
}

/**
 * 주기 호출 — 예약 도착을 먼저 처리하고, 하루 발신 한도 안에서 최대 1건을 새로 만든다.
 */
export async function tick(): Promise<TickResult> {
  let delivered: ScheduledMessage[] = [];
  try {
    delivered = await flushDue();
  } catch (error) {
    console.error("[proactive] flush failed:", error);
  }

  const user = getUser();
  const roster = getRoster();
  const base: TickResult = {
    delivered: delivered.length,
    generated: null,
    pendingIntroAt: roster.pendingIntro?.dueAt ?? null,
  };
  if (!user.onboarded) return base;

  // 새 친구 소개는 알림 설정·하루 한도와 무관하게 관계 순환의 일부다.
  const intro = await sendIntro();
  if (intro) return { ...base, generated: intro, pendingIntroAt: null };

  // 근황을 물으면 일관되게 답할 수 있도록, 활성 친구의 라이프 스케줄을 미리 채워 둔다.
  await Promise.all(
    activeFriends().map((friend) =>
      ensureSchedule(friend.tutorId).catch((error) => {
        console.error("[proactive] life schedule failed:", friend.tutorId, error);
      }),
    ),
  );

  if (!user.settings.notifications.enabled) return base;
  if (!withinLearnerWindow()) return base;

  const state = loadState();
  const limit = Math.max(0, Math.min(6, user.settings.dailyProactiveLimit ?? 3));
  if (state.sentToday >= limit) {
    saveState(state);
    return base;
  }

  const candidates = availableTutors();
  if (candidates.length === 0) {
    saveState(state);
    return base;
  }

  const today = todayStr();
  const hour = new Date().getHours();
  const noti = user.settings.notifications;
  const lastAny = Math.max(...candidates.map((tutorId) => getTutorState(tutorId).lastInteraction), 0);
  const daysSince = lastAny === 0 ? 0 : (Date.now() - lastAny) / 86_400_000;

  let type: ProactiveType | null = null;
  let tutorId = pickTutor(candidates, state.rotation);

  if (daysSince >= 3 && state.lastMissyou !== today && noti.checkin) {
    type = "missyou";
    state.lastMissyou = today;
  } else if (hour >= 8 && hour < 12 && state.lastMorning !== today && noti.morning) {
    type = "morning";
    state.lastMorning = today;
  } else if (hour >= 13 && hour < 19 && state.lastQuiz !== today && noti.quiz && getDueItems(1).length > 0) {
    type = "quiz";
    state.lastQuiz = today;
  } else if (noti.life && state.lastLife !== today) {
    // 사진 한 장이 질문 하나보다 대화를 잘 연다.
    const life = await sendLifePost(state, candidates);
    if (life) {
      state.sentToday += 1;
      state.rotation += 1;
      saveState(state);
      return { ...base, generated: life };
    }
  }

  if (!type && hour >= 19 && state.lastCheckin !== today && noti.checkin) {
    // 저녁 근황 질문 — 기억이 있는 친구를 우선한다.
    const withMemory = candidates.find((id) =>
      getTutorState(id).memory.some((fact) => fact.kind === "promise" || fact.kind === "recent"),
    );
    if (withMemory) tutorId = withMemory;
    type = "checkin";
    state.lastCheckin = today;
  }

  if (!type || !tutorId) {
    saveState(state);
    return base;
  }

  state.rotation += 1;
  const generated = await generate(tutorId, type);
  if (generated) state.sentToday += 1;
  saveState(state);
  return { ...base, generated };
}

/** 예약 도착만 처리하는 가벼운 경로 (채팅방 폴링에서 사용). */
export async function drainDeliveries(): Promise<ScheduledMessage[]> {
  try {
    return await flushDue();
  } catch (error) {
    console.error("[proactive] drain failed:", error);
    return [];
  }
}

/** 카톡 브릿지·수동 테스트에서 즉시 메시지를 하나 보내고 싶을 때. */
export async function sendNow(tutorId: string, text: string, ko = ""): Promise<ChatMessage> {
  const message = appendTutorMessage(tutorId, text, ko);
  const persona = getPersona(tutorId);
  await sendPush(persona.koName, text.slice(0, 120), `/chat/${tutorId}`);
  return message;
}

export function unreadTotal(): number {
  return getPersonas().reduce((total, persona) => {
    const messages = getChat(persona.id).messages;
    return total + messages.filter((message) => !message.read && message.role === "tutor").length;
  }, 0);
}

export function proactiveState(): ProactiveState {
  return loadState();
}

export function currentIntimacyLevel(tutorId: string): number {
  return intimacyLevel(getTutorState(tutorId).intimacyXp);
}
