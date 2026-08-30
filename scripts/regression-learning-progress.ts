import assert from "node:assert/strict";
import { summarizeLearningProgress } from "../src/core/learningProgress";
import type { SessionRecord } from "../src/core/types";

const now = Date.UTC(2026, 7, 25, 12);

function session(id: string, startedAt: number, scores: number[], userTurns = 2): SessionRecord {
  return {
    id,
    tutorId: "mia",
    mode: "learning",
    unitId: "unit-01",
    startedAt,
    endedAt: startedAt + 5 * 60_000,
    turns: Array.from({ length: userTurns }, (_, index) => ({
      id: `${id}-u${index}`,
      role: "user" as const,
      text: "Practice sentence",
      ts: startedAt + (index + 1) * 30_000,
    })),
    corrections: [{
      original: "I go yesterday",
      better: "I went yesterday",
      ko: "나는 어제 갔어요",
      reason: "과거형",
      type: "tense",
    }],
    judgments: scores.map((score) => ({
      target: "Could you help me?",
      said: "Could you help me?",
      score,
      pass: score >= 70,
      method: "similarity" as const,
    })),
    xpEarned: 10,
    stageState: {
      stage: "roleplay",
      reviewItems: [],
      reviewIndex: 0,
      introIndex: 1,
      practicedIds: [`${id}-expression`],
      roleplayUsedIds: [],
      turnsInStage: 1,
      combo: 1,
    },
    pronunciationScores: scores,
  };
}

const sessions = [
  session("old", now - 10 * 24 * 60 * 60_000, [60, 62, 64, 66, 68]),
  session("recent", now - 2 * 24 * 60 * 60_000, [74, 76, 78, 80, 82], 3),
  { ...session("empty", now - 60_000, []), turns: [] },
];

const progress = summarizeLearningProgress(sessions, now);
assert.equal(progress.totalSessions, 2);
assert.equal(progress.weeklySessions, 1);
assert.equal(progress.speakingTurns, 5);
assert.equal(progress.weeklySpeakingTurns, 3);
assert.equal(progress.correctedSentences, 2);
assert.equal(progress.practicedExpressions, 2);
assert.equal(progress.averagePronunciation, 71);
assert.equal(progress.pronunciationTrend, 14);
assert.equal(progress.practiceMinutes, 10);

const resumedToday = session("resumed-today", now - 10 * 24 * 60 * 60_000, [] , 1);
resumedToday.turns[0].ts = now - 30 * 60_000;
const resumedProgress = summarizeLearningProgress([resumedToday], now);
assert.equal(resumedProgress.weeklySessions, 1, "a resumed old session with a new turn counts this week");
assert.equal(resumedProgress.weeklySpeakingTurns, 1);

const serializedTrend = session("serialized-trend", now - 60_000, [], 10);
serializedTrend.turns = serializedTrend.turns.map((turn, index) => {
  const score = index < 5 ? 10 : 90;
  return {
    ...turn,
    ts: now - (10 - index) * 1_000,
    judgment: {
      target: "Could you help me?",
      said: "Could you help me?",
      score,
      pass: score >= 70,
      method: "similarity" as const,
    },
  };
});
serializedTrend.judgments = serializedTrend.turns.map((turn) => turn.judgment!);
const roundTripped = JSON.parse(JSON.stringify(serializedTrend)) as SessionRecord;
assert.equal(summarizeLearningProgress([roundTripped], now).pronunciationTrend, 80);

console.log("learning progress regression: totals, weekly activity, expressions, and score trend passed");
