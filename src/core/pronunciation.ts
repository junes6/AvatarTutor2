// 발음 평가 — Azure Pronunciation Assessment 키가 있으면 음소 채점,
// 없거나 실패하면 STT 재인식 유사도로 근사 채점하는 폴백.

import { config } from "./config";
import { sentenceSimilarity, wordMatches } from "./similarity";
import type { Judgment } from "./types";

const PASS_SCORE = 70;

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
  const params = Buffer.from(
    JSON.stringify({
      ReferenceText: target,
      GradingSystem: "HundredMark",
      Granularity: "Word",
      Dimension: "Comprehensive",
    }),
  ).toString("base64");

  const contentType = mimeType.includes("wav")
    ? "audio/wav"
    : "audio/ogg; codecs=opus"; // webm/opus 녹음도 opus 컨테이너로 시도

  const url = `https://${config.azure.region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US`;
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
    NBest?: { PronScore?: number; Words?: { Word: string; PronunciationAssessment?: { AccuracyScore?: number } }[] }[];
  };
  const best = data.NBest?.[0];
  if (data.RecognitionStatus !== "Success" || !best?.PronScore) return null;
  return {
    score: Math.round(best.PronScore),
    wordScores: (best.Words ?? []).map((w) => ({
      word: w.Word,
      score: Math.round(w.PronunciationAssessment?.AccuracyScore ?? 0),
    })),
  };
}
