import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import type { ChatMessage, TutorState, UserState } from "../src/core/types";

function jsonRequest(url: string, body: unknown, extraHeaders: Record<string, string> = {}) {
  const json = JSON.stringify(body);
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(json)), ...extraHeaders },
    body: json,
  });
}

async function main() {
  const tempRoot = path.resolve(os.tmpdir());
  const storeDir = fs.mkdtempSync(path.join(tempRoot, "avatar-tutor-systems-regression-"));
  const mutableEnv = process.env as Record<string, string | undefined>;
  const previousNodeEnv = mutableEnv.NODE_ENV;
  try {
    process.env.STORE_DIR = storeDir;
    process.env.SESSION_LOG_DIR = path.join(storeDir, "logs");
    process.env.ANTHROPIC_API_KEY = "";
    process.env.OPENAI_API_KEY = "";

    const stateRoute = await import("../src/app/api/state/route");
    const onboardingRoute = await import("../src/app/api/onboarding/route");
    const pushRoute = await import("../src/app/api/push/route");
    const sessionRoute = await import("../src/app/api/session/route");
    const avatarRoute = await import("../src/app/api/avatar/session/route");
    const healthRoute = await import("../src/app/api/health/route");
    const { proxy } = await import("../src/proxy");
    const { readJSON } = await import("../src/core/store");
    const { transcribe } = await import("../src/core/stt");
    const {
      cancelActiveSessionTurn,
      createSession,
      discardUnstartedSession,
      endSession,
      registerActiveSessionTurn,
      saveSession,
      withSessionLock,
    } = await import("../src/core/session");

    // Settings patches must preserve nested defaults and reject corrupt values.
    let response = await stateRoute.POST(jsonRequest("http://localhost/api/state", {
      settings: { notifications: { morning: false } },
    }));
    assert.equal(response.status, 200);
    let user = readJSON<UserState | null>("user", null);
    assert.equal(user?.settings.notifications.morning, false);
    assert.equal(user?.settings.notifications.enabled, true);
    response = await stateRoute.POST(jsonRequest("http://localhost/api/state", {
      settings: { speechRate: 9 },
    }));
    assert.equal(response.status, 400);

    // 프로필이 없거나 태그가 잘못되면 온보딩이 부분 완료되면 안 된다.
    response = await onboardingRoute.POST(jsonRequest("http://localhost/api/onboarding", {
      action: "complete", name: "Tester", level: 2, profile: { ageBand: "99s", occupation: "office", interests: ["food"], goal: "travel", style: "calm" },
    }));
    assert.equal(response.status, 400);
    user = readJSON<UserState | null>("user", null);
    assert.equal(user?.onboarded, false);

    const profile = {
      ageBand: "30s",
      occupation: "office",
      interests: ["coffee", "books", "outdoors"],
      goal: "work",
      style: "calm",
    };

    // 첫 매칭은 프로필 기반 2명 — 배정 전에 미리 볼 수 있어야 한다.
    const preview = await onboardingRoute.POST(jsonRequest("http://localhost/api/onboarding", {
      action: "preview", profile,
    }));
    assert.equal(preview.status, 200);
    const previewPayload = await preview.json();
    assert.equal(previewPayload.matches.length, 2, "first matching must assign exactly two friends");

    // Duplicate mobile submit is idempotent: one greeting and one intimacy point.
    const completeRequest = () => jsonRequest("http://localhost/api/onboarding", {
      action: "complete", name: "Tester", level: 2, profile,
    });
    const completed = await onboardingRoute.POST(completeRequest());
    assert.equal(completed.status, 200);
    const completedPayload = await completed.json();
    assert.equal(completedPayload.friends.length, 2);
    assert.equal((await onboardingRoute.POST(completeRequest())).status, 200);

    const [firstFriendId, secondFriendId] = completedPayload.friends as string[];
    const chat = readJSON<{ messages: ChatMessage[] }>(`chats/${firstFriendId}`, { messages: [] });
    const tutor = readJSON<TutorState | null>(`tutors/${firstFriendId}`, null);
    assert.equal(chat.messages.length, 1, "duplicate submit must not double the greeting");
    assert.equal(tutor?.intimacyXp, 1);
    // 두 사람이 동시에 말을 걸지 않도록 두 번째 인사는 지연 큐에 예약된다.
    const secondChat = readJSON<{ messages: ChatMessage[] }>(`chats/${secondFriendId}`, { messages: [] });
    assert.equal(secondChat.messages.length, 0, "the second friend must greet later, not at the same moment");
    const queue = readJSON<{ pending: { tutorId: string }[] }>("delivery", { pending: [] });
    assert.ok(
      queue.pending.some((entry) => entry.tutorId === secondFriendId),
      "the second greeting must be scheduled in the delivery queue",
    );

    // Push and session/avatar public inputs are bounded and validated.
    response = await pushRoute.POST(jsonRequest("http://localhost/api/push", {
      endpoint: "javascript:alert(1)", keys: { p256dh: "x", auth: "y" },
    }));
    assert.equal(response.status, 400);
    response = await pushRoute.POST(jsonRequest("http://localhost/api/push", {
      endpoint: "https://127.0.0.1/internal", keys: { p256dh: "x", auth: "y" },
    }));
    assert.equal(response.status, 400);
    response = await pushRoute.POST(jsonRequest("http://localhost/api/push", {
      endpoint: "https://push.example/subscription", keys: { p256dh: "key", auth: "auth" },
    }));
    assert.equal(response.status, 200);
    assert.equal(readJSON<{ subscriptions: unknown[] }>("push", { subscriptions: [] }).subscriptions.length, 1);
    assert.equal((await sessionRoute.GET(new Request("http://localhost/api/session?id=../../user"))).status, 400);
    assert.equal((await avatarRoute.POST(jsonRequest("http://localhost/api/avatar/session", { tutorId: "nope" }))).status, 400);

    // Session lifecycle is serialized and end/discard operations are idempotent.
    const disposable = createSession(firstFriendId, "freetalk");
    assert.equal(await discardUnstartedSession(disposable.id), true);
    assert.equal(await discardUnstartedSession(disposable.id), false);

    const listenedOnly = createSession(firstFriendId, "freetalk");
    await endSession(listenedOnly.id, 99);
    user = readJSON<UserState | null>("user", null);
    assert.equal(user?.dailyGoal.callSeconds, 0);
    assert.equal(readJSON<TutorState | null>(`tutors/${firstFriendId}`, null)?.intimacyXp, 1);

    const lifecycle = createSession(firstFriendId, "freetalk");
    lifecycle.turns.push({ id: "learner-turn", role: "user", text: "Hello", ts: Date.now() });
    saveSession(lifecycle);
    const activeTurn = new AbortController();
    registerActiveSessionTurn(lifecycle.id, activeTurn);
    cancelActiveSessionTurn(lifecycle.id);
    assert.equal(activeTurn.signal.aborted, true);
    const ended = await Promise.all([endSession(lifecycle.id, 12), endSession(lifecycle.id, 30)]);
    assert.equal(ended.filter((result) => result?.endedNow).length, 1);
    user = readJSON<UserState | null>("user", null);
    assert.ok(user?.dailyGoal.callSeconds === 12 || user?.dailyGoal.callSeconds === 30);

    const lockEvents: string[] = [];
    await Promise.all([
      withSessionLock("lock-regression", async () => {
        lockEvents.push("first-start");
        await new Promise((resolve) => setTimeout(resolve, 15));
        lockEvents.push("first-end");
      }),
      withSessionLock("lock-regression", async () => {
        lockEvents.push("second");
      }),
    ]);
    assert.deepEqual(lockEvents, ["first-start", "first-end", "second"]);

    // Cancellation must stop before even a mock STT call can continue.
    const cancelled = new AbortController();
    cancelled.abort(new Error("test cancellation"));
    await assert.rejects(
      () => transcribe(Buffer.from("audio"), "audio/webm", { feature: "test", signal: cancelled.signal }),
      /test cancellation/,
    );

    const health = await healthRoute.GET(new Request("http://localhost/api/health?force=1"));
    assert.equal(health.status, 200);
    const healthPayload = await health.json();
    assert.equal(healthPayload.storage, "writable");
    // 키가 없으면 데모 모드를 숨기지 않고 그대로 드러내야 한다.
    assert.equal(healthPayload.demo, true, "missing keys must be reported as demo mode");
    assert.equal(healthPayload.ok, false);
    const byKind = Object.fromEntries(
      (healthPayload.providers as { kind: string; status: string }[]).map((provider) => [provider.kind, provider.status]),
    );
    assert.equal(byKind.llm, "missing-key");
    assert.equal(byKind.stt, "missing-key");
    assert.equal(byKind.tts, "missing-key");
    assert.equal(byKind.photos, "disabled");
    assert.equal(healthPayload.realtime, "not-enabled");

    // Production Basic auth must also reject browser cross-site state changes.
    mutableEnv.NODE_ENV = "production";
    delete process.env.APP_BASIC_USER;
    delete process.env.APP_BASIC_PASSWORD;
    assert.equal(proxy(new NextRequest("https://app.example/")).status, 503);
    process.env.APP_BASIC_USER = "tester";
    process.env.APP_BASIC_PASSWORD = "strong-password";
    const authorization = `Basic ${Buffer.from("tester:strong-password").toString("base64")}`;
    assert.equal(proxy(new NextRequest("https://app.example/")).status, 401);
    assert.equal(proxy(new NextRequest("https://app.example/", { headers: { authorization } })).status, 200);
    const lanAllowed = proxy(new NextRequest("http://localhost:3000/api/session", {
      method: "POST",
      headers: {
        authorization,
        host: "192.168.50.25:3000",
        origin: "http://192.168.50.25:3000",
      },
    }));
    assert.equal(lanAllowed.status, 200, "same-origin LAN request was incorrectly blocked");
    const blocked = proxy(new NextRequest("https://app.example/api/state", {
      method: "POST",
      headers: {
        authorization,
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
      },
    }));
    assert.equal(blocked.status, 403);

    console.log("essential systems regression: persistence, idempotency, validation, cancellation, health, and CSRF passed");
  } finally {
    if (previousNodeEnv === undefined) delete mutableEnv.NODE_ENV;
    else mutableEnv.NODE_ENV = previousNodeEnv;
    delete process.env.STORE_DIR;
    delete process.env.SESSION_LOG_DIR;
    delete process.env.APP_BASIC_USER;
    delete process.env.APP_BASIC_PASSWORD;
    const resolvedStoreDir = path.resolve(storeDir);
    const expectedPrefix = `${tempRoot}${path.sep}avatar-tutor-systems-regression-`;
    if (resolvedStoreDir.startsWith(expectedPrefix)) {
      fs.rmSync(resolvedStoreDir, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
