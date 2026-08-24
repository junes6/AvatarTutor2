// 능동 시스템 — 튜터가 먼저 말을 건다.
// 클라이언트가 주기적으로 /api/proactive 를 호출(tick)하면 due인 메시지를 생성한다.
// 내용은 템플릿이 아니라 튜터 메모리 + 학습 이력 기반으로 LLM이 생성한다.

import { readJSON, writeJSON, todayStr } from "./store";
import { loadPrompt } from "./prompts";
import { chatLLM } from "./llm";
import { parseJsonLoose } from "./pipeline/parse";
import { getPersonas, getPersona, findExpression } from "./content";
import { getUser, getTutorState, intimacyLevel } from "./gamification";
import { formatMemory } from "./memory";
import { getDueItems } from "./srs";
import { appendTutorMessage } from "./chat";
import { sendPush } from "./push";
import type { ProactiveType, ChatMessage } from "./types";

interface ProactiveState {
  lastMorning: string;
  lastQuiz: string;
  lastCheckin: string;
  lastMissyou: string;
  rotation: number; // 튜터 로테이션 인덱스
}

const DEFAULT_STATE: ProactiveState = { lastMorning: "", lastQuiz: "", lastCheckin: "", lastMissyou: "", rotation: 0 };

function pickTutor(rotation: number): string {
  const personas = getPersonas();
  // 친밀도가 가장 높은 튜터에 가중치를 주되, 로테이션으로 다양성 확보
  const sorted = [...personas].sort(
    (a, b) => getTutorState(b.id).intimacyXp - getTutorState(a.id).intimacyXp,
  );
  return sorted[rotation % Math.min(2, sorted.length)]?.id ?? personas[0].id;
}

async function generate(tutorId: string, type: ProactiveType): Promise<ChatMessage | null> {
  const persona = getPersona(tutorId);
  const user = getUser();
  const ts = getTutorState(tutorId);
  const intimacy = intimacyLevel(ts.intimacyXp);

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
    learnerName: user.name || "친구",
    level: String(user.level),
    intimacy: String(intimacy),
    intimacyTone: persona.toneByIntimacy[String(intimacy)] ?? persona.toneByIntimacy["1"],
    memory: formatMemory(tutorId),
    proactiveType: type,
    quizExpression,
    quizExpressionKo,
  });

  try {
    const res = await chatLLM({
      system,
      messages: [{ role: "user", content: "메시지를 생성해 주세요." }],
      maxTokens: 400,
      feature: "proactive",
    });
    const parsed = parseJsonLoose<{ text?: string; ko?: string }>(res.text);
    if (!parsed?.text) return null;
    const msg = appendTutorMessage(tutorId, parsed.text, parsed.ko ?? "", type);
    await sendPush(persona.name, parsed.text, `/chat/${tutorId}`);
    return msg;
  } catch (e) {
    console.error("[proactive] generate failed:", e);
    return null;
  }
}

/** 주기 호출 — 조건이 맞으면 최대 1개의 능동 메시지를 생성한다 */
export async function tick(): Promise<{ generated: ProactiveType | null }> {
  const user = getUser();
  if (!user.onboarded || !user.settings.notifications.enabled) return { generated: null };

  const state = readJSON<ProactiveState>("proactive", DEFAULT_STATE);
  const today = todayStr();
  const hour = new Date().getHours();
  const noti = user.settings.notifications;

  const personas = getPersonas();
  const lastAny = Math.max(...personas.map((p) => getTutorState(p.id).lastInteraction), 0);
  const daysSince = lastAny === 0 ? 0 : (Date.now() - lastAny) / 86400000;

  let type: ProactiveType | null = null;
  let tutorId = pickTutor(state.rotation);

  if (daysSince >= 3 && state.lastMissyou !== today && noti.checkin) {
    type = "missyou";
    state.lastMissyou = today;
  } else if (hour >= 8 && hour < 12 && state.lastMorning !== today && noti.morning) {
    type = "morning";
    state.lastMorning = today;
  } else if (hour >= 13 && hour < 19 && state.lastQuiz !== today && noti.quiz && getDueItems(1).length > 0) {
    type = "quiz";
    state.lastQuiz = today;
  } else if (hour >= 19 && state.lastCheckin !== today && noti.checkin) {
    // 저녁 근황 질문 — 기억이 있는 튜터를 우선
    const withMemory = personas.find((p) => getTutorState(p.id).memory.some((f) => f.kind === "promise" || f.kind === "recent"));
    if (withMemory) tutorId = withMemory.id;
    type = "checkin";
    state.lastCheckin = today;
  }

  if (!type) return { generated: null };

  state.rotation++;
  writeJSON("proactive", state);
  const msg = await generate(tutorId, type);
  return { generated: msg ? type : null };
}
