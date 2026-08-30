import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function main() {
  const tempRoot = path.resolve(os.tmpdir());
  const storeDir = fs.mkdtempSync(path.join(tempRoot, "avatar-tutor-openai-regression-"));
  const originalFetch = globalThis.fetch;
  try {
    process.env.STORE_DIR = storeDir;
    process.env.SESSION_LOG_DIR = path.join(storeDir, "logs");
    process.env.LLM_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "server-only-test-key";
    process.env.OPENAI_LLM_MODEL = "gpt-5.6-terra";
    process.env.OPENAI_REALTIME_ENABLED = "true";
    process.env.OPENAI_REALTIME_MODEL = "gpt-realtime-2.1";
    process.env.OPENAI_REALTIME_TRANSCRIPTION_MODEL = "gpt-live-transcribe";
    process.env.TTS_PROVIDER = "bogus";
    process.env.ANTHROPIC_THINKING = "bogus";

    const requests: Array<{ url: string; init?: RequestInit }> = [];
    let realtimeGate: Promise<void> | null = null;
    let releaseRealtimeGate: () => void = () => undefined;
    let realtimeGateEntered: Promise<void> | null = null;
    let notifyRealtimeGateEntered: (() => void) | null = null;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      requests.push({ url, init });
      if (url.endsWith("/v1/responses")) {
        const body = JSON.parse(String(init?.body));
        assert.equal(init?.headers && (init.headers as Record<string, string>).Authorization, "Bearer server-only-test-key");
        assert.equal(body.model, "gpt-5.6-terra");
        assert.equal(body.store, false);
        assert.deepEqual(body.reasoning, { effort: "low" });
        return new Response(JSON.stringify({
          output: [{ content: [{ type: "output_text", text: "A relevant reply" }] }],
          usage: { input_tokens: 12, output_tokens: 4 },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/v1/realtime/calls")) {
        assert.equal(init?.headers && (init.headers as Record<string, string>).Authorization, "Bearer server-only-test-key");
        assert.ok(init?.body instanceof FormData);
        const form = init.body as FormData;
        assert.match(String(form.get("sdp")), /^v=0/);
        const session = JSON.parse(String(form.get("session")));
        assert.equal(session.model, "gpt-realtime-2.1");
        assert.equal(session.audio.input.transcription.model, "gpt-live-transcribe");
        assert.deepEqual(session.audio.input.transcription.languages, ["en", "ko"]);
        assert.equal(session.audio.input.transcription.delay, "low");
        assert.equal(session.audio.input.turn_detection, null, "push-to-talk transport must not auto-VAD");
        assert.notEqual(session.audio.output.voice, "");
        if (realtimeGate) {
          const gate = realtimeGate;
          realtimeGate = null;
          notifyRealtimeGateEntered?.();
          notifyRealtimeGateEntered = null;
          await gate;
        }
        return new Response("v=0\r\no=openai-answer", {
          status: 200,
          headers: { "Content-Type": "application/sdp" },
        });
      }
      if (url.endsWith("/v1/models")) {
        // /api/health 는 키 존재가 아니라 실제 호출로 연결을 검증한다.
        assert.equal(init?.headers && (init.headers as Record<string, string>).Authorization, "Bearer server-only-test-key");
        return new Response(JSON.stringify({ data: [{ id: "gpt-5.6-terra" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const { config, getLLMProvider, isRealtimeReady } = await import("../src/core/config");
    assert.equal(getLLMProvider(), "openai");
    assert.equal(isRealtimeReady(), true);
    assert.equal(config.tts.provider, "openai", "invalid TTS provider must normalize safely");
    assert.equal(config.anthropic.thinking, "disabled", "invalid thinking mode must normalize safely");

    const { chatLLM } = await import("../src/core/llm");
    const result = await chatLLM({
      system: "Reply to the learner",
      messages: [{ role: "user", content: "I forgot my passport" }],
      feature: "provider-regression",
    });
    assert.equal(result.text, "A relevant reply");
    assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 4 });

    const { createSession } = await import("../src/core/session");
    const call = createSession("mia", "freetalk");
    const realtimeRoute = await import("../src/app/api/realtime/call/route");
    let response: Response = await realtimeRoute.GET();
    const readiness = await response.json();
    assert.equal(readiness.ready, true);
    assert.equal(readiness.integrationStage, "server-handshake-ready");
    assert.equal(readiness.clientTransportEnabled, false);
    assert.equal(readiness.keyExposedToBrowser, false);
    assert.equal(JSON.stringify(readiness).includes("server-only-test-key"), false);

    response = await realtimeRoute.POST(new Request(
      `http://localhost/api/realtime/call?sessionId=${call.id}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: "v=0\r\no=browser-offer",
      },
    ));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/sdp");
    assert.match(await response.text(), /^v=0/);

    const concurrentCall = createSession("mia", "freetalk");
    realtimeGate = new Promise<void>((resolve) => { releaseRealtimeGate = resolve; });
    realtimeGateEntered = new Promise<void>((resolve) => { notifyRealtimeGateEntered = resolve; });
    const firstConcurrentRequest = realtimeRoute.POST(new Request(
      `http://localhost/api/realtime/call?sessionId=${concurrentCall.id}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: "v=0\r\no=first-browser-offer",
      },
    ));
    await realtimeGateEntered;
    let firstConcurrentResponse: Response | null = null;
    try {
      const duplicateResponse = await realtimeRoute.POST(new Request(
        `http://localhost/api/realtime/call?sessionId=${concurrentCall.id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/sdp" },
          body: "v=0\r\no=duplicate-browser-offer",
        },
      ));
      assert.equal(
        duplicateResponse.status,
        429,
        "a second Realtime handshake must be rejected while the first is still in flight",
      );
    } finally {
      releaseRealtimeGate();
      firstConcurrentResponse = await firstConcurrentRequest;
    }
    assert.equal(firstConcurrentResponse.status, 200, "the original Realtime handshake must still complete");

    const learning = createSession("mia", "learning");
    response = await realtimeRoute.POST(new Request(
      `http://localhost/api/realtime/call?sessionId=${learning.id}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: "v=0\r\no=browser-offer",
      },
    ));
    assert.equal(response.status, 409, "Realtime must not bypass the learning-state pipeline");

    const scenario = createSession("mia", "freetalk", { scenarioId: "airport" });
    response = await realtimeRoute.POST(new Request(
      `http://localhost/api/realtime/call?sessionId=${scenario.id}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: "v=0\r\no=browser-offer",
      },
    ));
    assert.equal(response.status, 409, "Realtime must not bypass scenario grounding guards");
    assert.equal(requests.filter((request) => request.url.endsWith("/v1/responses")).length, 1);
    assert.equal(requests.filter((request) => request.url.endsWith("/v1/realtime/calls")).length, 2);

    const healthRoute = await import("../src/app/api/health/route");
    const health = await (await healthRoute.GET(new Request("http://localhost/api/health?force=1"))).json();
    const providers = Object.fromEntries(
      (health.providers as { kind: string; provider: string; status: string }[]).map((provider) => [
        provider.kind,
        provider,
      ]),
    );
    assert.equal(providers.llm.provider, "gpt-5.6-terra");
    assert.equal(providers.llm.status, "live", "a working key must verify as live, not merely present");
    assert.equal(health.demo, false);
    assert.equal(health.realtime, "gpt-realtime-2.1");
    const adminRoute = await import("../src/app/api/admin/route");
    const admin = await (await adminRoute.GET()).json();
    assert.equal(admin.providers.llm, "gpt-5.6-terra");

    console.log("OpenAI provider and Realtime WebRTC readiness regression: ok");
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of [
      "STORE_DIR",
      "SESSION_LOG_DIR",
      "LLM_PROVIDER",
      "OPENAI_API_KEY",
      "OPENAI_LLM_MODEL",
      "OPENAI_REALTIME_ENABLED",
      "OPENAI_REALTIME_MODEL",
      "OPENAI_REALTIME_TRANSCRIPTION_MODEL",
      "TTS_PROVIDER",
      "ANTHROPIC_THINKING",
    ]) delete process.env[name];
    if (storeDir.startsWith(`${tempRoot}${path.sep}`)) fs.rmSync(storeDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
