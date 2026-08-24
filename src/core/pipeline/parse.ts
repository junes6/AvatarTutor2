// LLM 응답(JSON 계약) 파싱 — 코드펜스/잡음이 섞여도 최대한 복구한다.

import type { TutorTurnOutput, CorrectionCard, SuggestionCard } from "../types";

export function parseJsonLoose<T>(text: string): T | null {
  const cleaned = text.replace(/```(?:json)?/g, "").trim();
  // 첫 '{'부터 균형이 맞는 '}'까지 추출
  const start = cleaned.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') inStr = !inStr;
    if (inStr) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1)) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

const VALID_TYPES = new Set(["grammar", "article", "tense", "preposition", "konglish", "awkward", "word-choice"]);

function sanitizeCorrection(c: unknown): CorrectionCard | null {
  if (!c || typeof c !== "object") return null;
  const o = c as Record<string, unknown>;
  if (typeof o.original !== "string" || typeof o.better !== "string" || !o.better) return null;
  return {
    original: o.original,
    better: o.better,
    ko: typeof o.ko === "string" ? o.ko : "",
    reason: typeof o.reason === "string" ? o.reason : "",
    type: VALID_TYPES.has(o.type as string) ? (o.type as CorrectionCard["type"]) : "awkward",
  };
}

function sanitizeSuggestion(s: unknown): SuggestionCard | null {
  if (!s || typeof s !== "object") return null;
  const o = s as Record<string, unknown>;
  if (typeof o.en !== "string" || !o.en) return null;
  return { en: o.en, ko: typeof o.ko === "string" ? o.ko : "" };
}

/** LLM 원문 → 안전한 TutorTurnOutput. 파싱 실패 시 원문 전체를 reply로 사용. */
export function sanitizeTurnOutput(rawText: string): TutorTurnOutput {
  const parsed = parseJsonLoose<Record<string, unknown>>(rawText);
  if (!parsed || typeof parsed.reply !== "string") {
    return {
      reply: rawText.trim().slice(0, 500) || "Sorry, could you say that again?",
      reply_ko: "",
      correction: null,
      suggestion: null,
      new_expression: null,
      used_expressions: [],
      stage_signal: "stay",
      end_call: false,
    };
  }
  return {
    reply: parsed.reply,
    reply_ko: typeof parsed.reply_ko === "string" ? parsed.reply_ko : "",
    correction: sanitizeCorrection(parsed.correction),
    suggestion: sanitizeSuggestion(parsed.suggestion),
    new_expression: typeof parsed.new_expression === "string" ? parsed.new_expression : null,
    used_expressions: Array.isArray(parsed.used_expressions)
      ? parsed.used_expressions.filter((x): x is string => typeof x === "string")
      : [],
    stage_signal: parsed.stage_signal === "advance" ? "advance" : "stay",
    end_call: parsed.end_call === true,
  };
}
