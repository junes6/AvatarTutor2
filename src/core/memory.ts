// 튜터별 장기기억 — 세션/채팅 종료 시 요약을 추출해 저장하고 다음 대화에 주입.

import { loadPrompt } from "./prompts";
import { chatLLM } from "./llm";
import { getPersona } from "./content";
import { getTutorState, addMemoryFacts } from "./gamification";
import { parseJsonLoose } from "./pipeline/parse";
import { todayStr } from "./store";
import type { MemoryFact, TurnLog, ChatMessage } from "./types";

export function formatMemory(tutorId: string): string {
  const facts = getTutorState(tutorId).memory;
  if (facts.length === 0) return "(아직 없음 — 첫 대화이거나 기억이 쌓이기 전입니다)";
  return facts.map((f) => `- [${f.date}] ${f.text} (${f.kind})`).join("\n");
}

/** 세션/채팅 종료 후 호출: 대화에서 기억할 것을 추출해 저장 */
export async function summarizeToMemory(
  tutorId: string,
  transcript: { role: string; text: string }[],
): Promise<MemoryFact[]> {
  if (transcript.length < 4) return []; // 너무 짧은 대화는 스킵
  const persona = getPersona(tutorId);
  const existing = getTutorState(tutorId).memory.map((f) => f.text).join(" / ") || "(없음)";
  const text = transcript
    .map((t) => `${t.role === "user" ? "학습자" : persona.name}: ${t.text}`)
    .join("\n");

  const system = loadPrompt("memory-summarizer", {
    name: persona.name,
    existingMemory: existing,
    transcript: text.slice(0, 8000),
  });
  try {
    const res = await chatLLM({
      system,
      messages: [{ role: "user", content: "위 대화에서 기억할 것을 추출해 주세요." }],
      maxTokens: 600,
      feature: "memory",
    });
    const parsed = parseJsonLoose<{ facts?: { text: string; kind: MemoryFact["kind"] }[] }>(res.text);
    const facts: MemoryFact[] = (parsed?.facts ?? [])
      .filter((f) => f.text)
      .slice(0, 5)
      .map((f) => ({ text: f.text, kind: f.kind ?? "recent", date: todayStr() }));
    if (facts.length > 0) addMemoryFacts(tutorId, facts);
    return facts;
  } catch (e) {
    console.error("[memory] summarize failed:", e);
    return [];
  }
}

export function turnsToTranscript(turns: TurnLog[]): { role: string; text: string }[] {
  return turns.map((t) => ({ role: t.role, text: t.text }));
}

export function chatToTranscript(messages: ChatMessage[]): { role: string; text: string }[] {
  return messages.map((m) => ({ role: m.role, text: m.text }));
}
