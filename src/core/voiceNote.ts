// 음성 메시지 — 오디오는 재생 시점에 /api/tts로 합성하고, 여기서는
// 말풍선에 필요한 길이·파형·스크립트만 만든다 (저장소에 오디오를 쌓지 않는다).

import type { VoiceNote } from "./types";

const PEAK_COUNT = 36;
/** 원어민 캐주얼 발화 대략 155 wpm */
const WORDS_PER_SECOND = 155 / 60;

function hash(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

/**
 * 같은 문장은 항상 같은 파형으로 그려져야 한다 (다시 불러와도 모양이 안 바뀜).
 * 실제 오디오 분석이 아니라 문장 해시 기반의 일관된 시각화다.
 */
export function waveformPeaks(text: string, count = PEAK_COUNT): number[] {
  let seed = hash(text) || 1;
  const peaks: number[] = [];
  for (let i = 0; i < count; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const base = 0.28 + (seed % 1000) / 1000 * 0.62;
    // 문장 끝으로 갈수록 살짝 잦아드는 자연스러운 봉투선
    const envelope = 0.75 + 0.25 * Math.sin((i / count) * Math.PI);
    peaks.push(Math.round(Math.min(1, base * envelope) * 100) / 100);
  }
  return peaks;
}

export function estimateDurationSec(script: string): number {
  const words = script.trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return 1;
  return Math.max(1, Math.round((words / WORDS_PER_SECOND + 0.6) * 10) / 10);
}

export function buildVoiceNote(script: string, scriptKo?: string): VoiceNote {
  return {
    durationSec: estimateDurationSec(script),
    peaks: waveformPeaks(script),
    script,
    scriptKo,
  };
}

/** 음성으로 보내면 자연스러운 메시지인지 — 너무 길면 텍스트가 낫다. */
export function suitsVoice(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return words >= 4 && words <= 45;
}

export function formatDuration(seconds: number): string {
  const total = Math.max(1, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
