import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SessionRecord, UserState } from "../src/core/types";

function jsonRequest(body: unknown) {
  const json = JSON.stringify(body);
  return new Request("http://localhost/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(json)) },
    body: json,
  });
}

async function main() {
  const tempRoot = path.resolve(os.tmpdir());
  const storeDir = fs.mkdtempSync(path.join(tempRoot, "avatar-tutor-resume-regression-"));
  try {
    process.env.STORE_DIR = storeDir;
    process.env.SESSION_LOG_DIR = path.join(storeDir, "logs");
    process.env.ANTHROPIC_API_KEY = "";
    process.env.OPENAI_API_KEY = "";

    const sessionRoute = await import("../src/app/api/session/route");
    const stateRoute = await import("../src/app/api/state/route");
    const turnRoute = await import("../src/app/api/turn/route");
    const {
      createSession,
      checkpointSession,
      endSession,
      getResumableSessions,
      getSession,
      pauseSession,
      resumeSession,
      saveSession,
    } = await import("../src/core/session");
    const { readJSON } = await import("../src/core/store");
    const { getReportDurationLabel } = await import("../src/lib/reportPresentation");

    const greetingOnly = createSession("jack", "freetalk", { scenarioId: "airport" });
    greetingOnly.turns.push({
      id: "tutor-only-greeting",
      role: "tutor",
      text: "May I see your passport?",
      ts: 1_000,
    });
    saveSession(greetingOnly);
    await pauseSession(greetingOnly.id, 5);
    assert.equal(
      getResumableSessions().some((candidate) => candidate.sessionId === greetingOnly.id),
      false,
      "a greeting-only call must not replace a learner's real continuation",
    );
    greetingOnly.pendingTurn = {
      text: "I'm sorry, I forgot my passport.",
      inputLanguage: "en-US",
      repeatTarget: "I'm sorry, I forgot my passport.",
      savedAt: 1_050,
    };
    saveSession(greetingOnly);
    await pauseSession(greetingOnly.id, 6, greetingOnly.pendingTurn);
    assert.equal(
      getResumableSessions().some((candidate) => candidate.sessionId === greetingOnly.id),
      true,
      "an interrupted first utterance must remain resumable",
    );
    await endSession(greetingOnly.id, 6);

    const learning = createSession("mia", "learning", { unitId: "unit-01" });
    learning.turns.push(
      { id: "tutor-greeting", role: "tutor", text: "Let's continue with introductions.", ko: "자기소개를 계속해 봐요.", ts: 1_100 },
      { id: "learner-one", role: "user", text: "I'm from Korea.", ts: 1_200 },
      {
        id: "tutor-one",
        role: "tutor",
        text: "Great. Now say: I work as a designer.",
        ko: "좋아요. 이제 ‘저는 디자이너로 일해요’라고 말해보세요.",
        ts: 1_300,
        suggestion: { en: "I work as a designer.", ko: "저는 디자이너로 일해요." },
      },
    );
    learning.stageState!.stage = "intro";
    learning.stageState!.introIndex = 2;
    learning.stageState!.practicedIds = ["u1e1"];
    learning.lastActiveAt = 1_300;
    saveSession(learning);

    const paused = await pauseSession(learning.id, 37);
    assert.ok(paused?.pausedAt, "pause must be persisted");
    assert.equal(paused?.elapsedSeconds, 37);
    await pauseSession(learning.id, 30);
    assert.equal(getSession(learning.id)?.elapsedSeconds, 37, "duplicate/older pause must not reduce or double time");

    let resumable = getResumableSessions();
    assert.equal(resumable.length, 1);
    assert.equal(resumable[0].sessionId, learning.id);
    assert.deepEqual(resumable[0].learnedExpressionIds, ["u1e1", "u1e2"]);
    assert.equal(resumable[0].stageState?.stage, "intro");
    assert.equal(resumable[0].userTurnCount, 1);

    let response: Response = await turnRoute.POST(jsonRequest({
      sessionId: learning.id,
      text: "This stale tab must not add another turn.",
      textAuthoritative: true,
    }));
    assert.equal(response.status, 409, "a stale page must not write turns while the session is paused");
    assert.equal(getSession(learning.id)?.turns.length, 3);

    response = await sessionRoute.GET(new Request("http://localhost/api/session?resumable=1"));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).resumableSessions[0].sessionId, learning.id);

    response = await sessionRoute.POST(jsonRequest({ action: "resume", sessionId: learning.id }));
    assert.equal(response.status, 200);
    const restored = await response.json();
    assert.equal(restored.resumed, true);
    assert.equal(restored.sessionId, learning.id);
    assert.equal(restored.elapsedSeconds, 37);
    assert.equal(restored.turns.length, 3);
    assert.equal(restored.stageState.introIndex, 2);
    assert.deepEqual(restored.learnedExpressionIds, ["u1e1", "u1e2"]);
    assert.equal(restored.expressionCard.id, "u1e2");
    assert.equal(restored.lastTutorTurn.suggestion.en, "I work as a designer.");
    assert.equal(getSession(learning.id)?.pausedAt, undefined);

    response = await sessionRoute.POST(jsonRequest({
      action: "start",
      tutorId: "mia",
      mode: "learning",
      unitId: "unit-01",
      resumeSessionId: learning.id,
    }));
    assert.equal(response.status, 200);
    const alreadyLive = await response.json();
    assert.equal(alreadyLive.sessionId, learning.id, "start+resume must not create a second practice");
    assert.equal(alreadyLive.resumeCount, 1, "idempotent live restore must not inflate resume count");

    const state = await (await stateRoute.GET()).json();
    assert.equal(state.resumableSessions[0].sessionId, learning.id);
    assert.equal(state.resumableSessions[0].elapsedSeconds, 37);

    const checkpointed = await checkpointSession(learning.id, 42);
    assert.equal(checkpointed?.elapsedSeconds, 42);
    assert.equal(checkpointed?.pausedAt, undefined, "background checkpoint must keep a live session writable");

    const lifecycleBase = getSession(learning.id)?.lifecycleVersion ?? Date.now();
    const interruptedDraft = {
      text: "Let me repeat that.",
      inputLanguage: "en-US",
      clientTurnId: "client-turn-one",
      savedAt: Date.now(),
    } as const;
    await pauseSession(learning.id, 43, interruptedDraft, lifecycleBase + 1);
    await resumeSession(learning.id, lifecycleBase + 2);
    await pauseSession(learning.id, 43, interruptedDraft, lifecycleBase + 1);
    assert.equal(
      getSession(learning.id)?.pausedAt,
      undefined,
      "a late pagehide pause must not override a newer BFCache resume",
    );
    const afterInterruptedTurn = getSession(learning.id) as SessionRecord;
    afterInterruptedTurn.turns.push({
      id: "learner-interrupted-turn",
      role: "user",
      text: interruptedDraft.text,
      clientTurnId: interruptedDraft.clientTurnId,
      ts: Date.now(),
    });
    saveSession(afterInterruptedTurn);
    await checkpointSession(learning.id, 44, interruptedDraft, lifecycleBase + 3);
    assert.equal(
      getSession(learning.id)?.pendingTurn,
      undefined,
      "a late draft with an already-saved client turn id must not be restored",
    );
    const withAnotherDraft = getSession(learning.id) as SessionRecord;
    withAnotherDraft.pendingTurn = { ...interruptedDraft, clientTurnId: "client-turn-two" };
    saveSession(withAnotherDraft);
    await checkpointSession(learning.id, 44, null, lifecycleBase + 4);
    assert.equal(getSession(learning.id)?.pendingTurn, undefined, "an explicit empty checkpoint must clear a stale draft");

    const current = getSession(learning.id) as SessionRecord;
    current.stageState!.stage = "practice";
    current.stageState!.practicedIds = ["u1e1", "u1e2"];
    saveSession(current);
    await pauseSession(learning.id, 51);
    const ended = await endSession(learning.id, 45);
    assert.equal(ended?.session.elapsedSeconds, 51, "ending must preserve the larger persisted active time");
    assert.equal(getReportDurationLabel(ended!.session), "51초");
    const user = readJSON<UserState | null>("user", null);
    assert.equal(user?.dailyGoal.callSeconds, 51);
    resumable = getResumableSessions();
    assert.equal(resumable.length, 0, "ended practice must not be offered for continuation");

    response = await sessionRoute.POST(jsonRequest({ action: "resume", sessionId: learning.id }));
    assert.equal(response.status, 409);
    response = await sessionRoute.POST(jsonRequest({ action: "pause", sessionId: learning.id, elapsedSeconds: -1 }));
    assert.equal(response.status, 400);

    console.log("session resume regression: turns, stage, expressions, active time, API and state restoration passed");
  } finally {
    delete process.env.STORE_DIR;
    delete process.env.SESSION_LOG_DIR;
    const resolvedStoreDir = path.resolve(storeDir);
    const expectedPrefix = `${tempRoot}${path.sep}avatar-tutor-resume-regression-`;
    if (resolvedStoreDir.startsWith(expectedPrefix)) fs.rmSync(resolvedStoreDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
