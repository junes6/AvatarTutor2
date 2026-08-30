// 발음 평가 — Azure Pronunciation Assessment 키가 있으면 음소 채점,
// 없거나 실패하면 STT 재인식 유사도로 근사 채점하는 폴백.

import { config } from "./config";
import { sentenceSimilarity, wordMatches } from "./similarity";
import type { Judgment } from "./types";

const PASS_SCORE = 70;
const AZURE_WAV_CONTENT_TYPE = "audio/wav; codecs=audio/pcm; samplerate=16000";
const AZURE_OGG_CONTENT_TYPE = "audio/ogg; codecs=opus";

const META_QUESTION = /(?:\b(?:what does|what do you mean|how do (?:i|you) say|can you (?:explain|repeat|help)|why (?:is|do|does)|i have a question)\b|무슨\s*뜻|뜻이|설명|질문|왜\s|어떻게\s*말|다시\s*(?:말|설명))/i;

/**
 * 제안 카드가 열려 있어도 사용자는 질문하거나 대화를 이어갈 수 있다.
 * 최종 STT 문장이 목표 문장과 실제로 닮은 경우에만 따라 말하기 시도로
 * 분류해, 일반 발화를 발음 실패로 오판하지 않는다.
 */
export function isLikelyRepeatAttempt(target: string, saidTranscript: string): boolean {
  const targetText = target.trim();
  const saidText = saidTranscript.trim();
  if (!targetText || !saidText) return false;

  const score = sentenceSimilarity(targetText, saidText);
  if (score >= 80) return true;
  if (META_QUESTION.test(saidText)) return false;
  if (score >= 55) return true;

  const words = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9가-힣' ]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 1);
  const targetWords = words(targetText);
  const saidWords = new Set(words(saidText));
  if (targetWords.length === 0 || saidWords.size === 0) return false;
  const overlap = targetWords.filter((word) => saidWords.has(word)).length / targetWords.length;

  // 짧은 STT 누락에는 관대하되, 주제가 조금 겹치는 일반 대화는 제외한다.
  return score >= 35 && overlap >= 0.6;
}

function isPcm16kMonoWav(audio: Buffer): boolean {
  if (
    audio.length < 44 ||
    audio.toString("ascii", 0, 4) !== "RIFF" ||
    audio.toString("ascii", 8, 12) !== "WAVE"
  ) {
    return false;
  }

  let offset = 12;
  while (offset + 8 <= audio.length) {
    const chunkId = audio.toString("ascii", offset, offset + 4);
    const chunkSize = audio.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    if (chunkStart + chunkSize > audio.length) return false;
    if (chunkId === "fmt " && chunkSize >= 16) {
      const audioFormat = audio.readUInt16LE(chunkStart);
      const channels = audio.readUInt16LE(chunkStart + 2);
      const sampleRate = audio.readUInt32LE(chunkStart + 4);
      const bitsPerSample = audio.readUInt16LE(chunkStart + 14);
      return audioFormat === 1 && channels === 1 && sampleRate === 16_000 && bitsPerSample === 16;
    }
    offset = chunkStart + chunkSize + (chunkSize % 2);
  }
  return false;
}

/** Azure short-audio REST에 실제로 허용되는 바이트/컨테이너만 보낸다. */
export function getAzurePronunciationContentType(audio: Buffer, mimeType: string): string | null {
  const normalizedMime = mimeType.toLowerCase();
  if (normalizedMime.includes("wav") && isPcm16kMonoWav(audio)) return AZURE_WAV_CONTENT_TYPE;
  if (
    normalizedMime.includes("ogg") &&
    audio.length >= 8 &&
    audio.toString("ascii", 0, 4) === "OggS" &&
    audio.indexOf("OpusHead", 0, "ascii") >= 0
  ) {
    return AZURE_OGG_CONTENT_TYPE;
  }
  // MediaRecorder의 WebM/MP4는 Opus/AAC 코덱이어도 OGG/WAV 컨테이너가 아니다.
  // 트랜스코딩 없이 Content-Type만 바꾸지 않고 transcript 유사도 평가로 폴백한다.
  return null;
}

export async function assessPronunciation(
  target: string,
  saidTranscript: string,
  audio: Buffer | null,
  mimeType: string,
): Promise<Judgment> {
  if (config.azure.key && audio) {
    try {
      const azure = await assessAzure(target, audio, mimeType);
      if (azure) {
        return {
          target,
          said: saidTranscript,
          score: azure.score,
          pass: azure.score >= PASS_SCORE,
          method: "azure",
          wordScores: azure.wordScores,
        };
      }
    } catch (e) {
      console.error("[pronunciation] azure failed, using similarity fallback:", e);
    }
  }
  const score = sentenceSimilarity(target, saidTranscript);
  return {
    target,
    said: saidTranscript,
    score,
    pass: score >= PASS_SCORE,
    method: "similarity",
    wordScores: wordMatches(target, saidTranscript),
  };
}

async function assessAzure(
  target: string,
  audio: Buffer,
  mimeType: string,
): Promise<{ score: number; wordScores: { word: string; score: number }[] } | null> {
  const contentType = getAzurePronunciationContentType(audio, mimeType);
  if (!contentType) return null;

  const params = Buffer.from(
    JSON.stringify({
      ReferenceText: target,
      GradingSystem: "HundredMark",
      Granularity: "Word",
      Dimension: "Comprehensive",
    }),
  ).toString("base64");

  const url = `https://${config.azure.region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": config.azure.key,
      "Pronunciation-Assessment": params,
      "Content-Type": contentType,
      Accept: "application/json",
    },
    body: new Uint8Array(audio),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    RecognitionStatus?: string;
    NBest?: {
      PronScore?: number;
      PronunciationAssessment?: { PronScore?: number };
      Words?: {
        Word: string;
        AccuracyScore?: number;
        PronunciationAssessment?: { AccuracyScore?: number };
      }[];
    }[];
  };
  const best = data.NBest?.[0];
  const pronScore = best?.PronScore ?? best?.PronunciationAssessment?.PronScore;
  if (data.RecognitionStatus !== "Success" || typeof pronScore !== "number") return null;
  return {
    score: Math.round(pronScore),
    wordScores: (best?.Words ?? []).map((w) => ({
      word: w.Word,
      score: Math.round(w.AccuracyScore ?? w.PronunciationAssessment?.AccuracyScore ?? 0),
    })),
  };
}
