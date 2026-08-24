// 사용량 기록 — /admin 일별 원가 추정에 사용.

import { readJSON, writeJSON } from "./store";
import type { UsageEntry } from "./types";
import { PRICING } from "./config";

export function logUsage(entry: UsageEntry) {
  const data = readJSON<{ entries: UsageEntry[] }>("usage", { entries: [] });
  data.entries.push(entry);
  // 무한 성장 방지: 최근 20000건만 유지
  if (data.entries.length > 20000) data.entries = data.entries.slice(-20000);
  writeJSON("usage", data);
}

export interface DailyUsage {
  date: string;
  llmInputTokens: number;
  llmOutputTokens: number;
  sttSeconds: number;
  ttsChars: number;
  costUsd: number;
  costKrw: number;
  calls: number;
}

export function aggregateDaily(): DailyUsage[] {
  const data = readJSON<{ entries: UsageEntry[] }>("usage", { entries: [] });
  const byDay = new Map<string, DailyUsage>();
  for (const e of data.entries) {
    const d = new Date(e.ts);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    let row = byDay.get(date);
    if (!row) {
      row = { date, llmInputTokens: 0, llmOutputTokens: 0, sttSeconds: 0, ttsChars: 0, costUsd: 0, costKrw: 0, calls: 0 };
      byDay.set(date, row);
    }
    row.calls++;
    if (e.kind === "llm") {
      row.llmInputTokens += e.inputTokens ?? 0;
      row.llmOutputTokens += e.outputTokens ?? 0;
    } else if (e.kind === "stt") {
      row.sttSeconds += e.seconds ?? 0;
    } else if (e.kind === "tts") {
      row.ttsChars += e.chars ?? 0;
    }
  }
  for (const row of byDay.values()) {
    row.costUsd =
      (row.llmInputTokens / 1_000_000) * PRICING.llmInputPerMTok +
      (row.llmOutputTokens / 1_000_000) * PRICING.llmOutputPerMTok +
      (row.sttSeconds / 60) * PRICING.sttPerMinute +
      (row.ttsChars / 1_000_000) * PRICING.ttsPerMChars;
    row.costKrw = Math.round(row.costUsd * PRICING.usdToKrw);
  }
  return [...byDay.values()].sort((a, b) => b.date.localeCompare(a.date));
}
