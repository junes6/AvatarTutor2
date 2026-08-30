// 첫 화면부터 학습자 수준을 넘는 장문 소개를 보내지 않도록, 페르소나별로
// 레벨에 맞는 짧은 1질문 인사를 데이터(data/personas.json)에서 읽어 쓴다.

import type { TutorPersona } from "./types";

export interface OnboardingGreeting {
  en: string;
  ko: string;
}

export type GreetingBand = "beginner" | "intermediate" | "advanced";

export function levelBand(level: number): GreetingBand {
  const normalized = Math.max(1, Math.min(5, Number.isFinite(level) ? Math.round(level) : 2));
  if (normalized <= 2) return "beginner";
  if (normalized === 3) return "intermediate";
  return "advanced";
}

function fill(template: string, name: string): string {
  return template.replace(/\{name\}/g, name);
}

function firstName(persona: TutorPersona): string {
  return persona.name.split(" ")[0] || persona.name;
}

/**
 * 데이터에 문구가 없는 경우에도 레벨별로 서로 다른, 질문 하나짜리 인사를 만든다.
 * (새 페르소나를 추가하고 greetings를 아직 안 채웠을 때의 안전망)
 */
function fallback(persona: TutorPersona, name: string, band: GreetingBand): OnboardingGreeting {
  const who = firstName(persona);
  const city = persona.life?.homeCity ?? "";
  if (band === "beginner") {
    return {
      en: `Hi, ${name}—I'm ${who}! What do you like to do?`,
      ko: `안녕하세요, ${name}! 저는 ${persona.koName}예요. 뭐 하는 걸 좋아하세요?`,
    };
  }
  if (band === "intermediate") {
    return {
      en: `Hi, ${name}! I'm ${who}${city ? `, and I live in ${city}` : ""}. What do you enjoy talking about?`,
      ko: `안녕하세요, ${name}! 저는 ${persona.koName}예요${city ? ` (${city}에 살아요)` : ""}. 어떤 이야기를 좋아하세요?`,
    };
  }
  return {
    en: `Hi, ${name}! I'm ${who}${city ? ` from ${city}` : ""}, and I could talk about almost anything. What's been on your mind lately?`,
    ko: `안녕하세요, ${name}! 저는 ${persona.koName}예요${city ? ` (${city})` : ""}. 뭐든 이야기할 수 있어요. 요즘 어떤 생각을 많이 하세요?`,
  };
}

export function onboardingGreeting(persona: TutorPersona, learnerName: string, level: number): OnboardingGreeting {
  const name = learnerName.trim() || "there";
  const band = levelBand(level);
  const template = persona.greetings?.[band];
  if (!template?.en) return fallback(persona, name, band);
  return { en: fill(template.en, name), ko: fill(template.ko, name) };
}
