import { NextResponse } from "next/server";
import { config, isRealtimeReady } from "@/core/config";
import { buildRealtimeInstructions, getRealtimeVoice } from "@/core/realtime/instructions";
import { getSession } from "@/core/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_SDP_BYTES = 64 * 1024;
const OPENAI_TIMEOUT_MS = 15_000;
const SESSION_RECONNECT_COOLDOWN_MS = 8_000;
type RealtimeConnectionState = {
  startedAt: number;
  status: "connecting" | "connected";
};
const recentConnections = new Map<string, RealtimeConnectionState>();

function unavailable() {
  return NextResponse.json(
    {
      error: "Realtime voice is not enabled",
      code: config.openai.apiKey ? "realtime-disabled" : "openai-key-required",
    },
    { status: 503, headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function GET() {
  return NextResponse.json(
    {
      ready: isRealtimeReady(),
      transport: "webrtc",
      model: config.openai.realtimeModel,
      transcriptionModel: config.openai.realtimeTranscriptionModel,
      pilotModes: ["pure-freetalk"],
      integrationStage: "server-handshake-ready",
      clientTransportEnabled: false,
      keyExposedToBrowser: false,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(request: Request) {
  if (!isRealtimeReady()) return unavailable();
  if (request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/sdp") {
    return NextResponse.json({ error: "Expected application/sdp" }, { status: 415 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_SDP_BYTES) {
    return NextResponse.json({ error: "SDP offer too large" }, { status: 413 });
  }

  const sessionId = new URL(request.url).searchParams.get("sessionId") ?? "";
  if (!/^s[a-z0-9_-]{6,80}$/i.test(sessionId)) {
    return NextResponse.json({ error: "Invalid session" }, { status: 400 });
  }
  const session = getSession(sessionId);
  if (!session || session.endedAt || session.pausedAt) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (session.mode !== "freetalk" || session.scenarioId || session.unitId) {
    return NextResponse.json(
      { error: "Realtime pilot currently supports pure freetalk only" },
      { status: 409 },
    );
  }
  const sdp = await request.text();
  if (!sdp.startsWith("v=0") || Buffer.byteLength(sdp) > MAX_SDP_BYTES) {
    return NextResponse.json({ error: "Invalid SDP offer" }, { status: 400 });
  }

  // Check and reserve the session without an await between the two operations.
  // This prevents two simultaneous browser requests from opening paid calls.
  const connectionStartedAt = Date.now();
  const previousConnection = recentConnections.get(sessionId);
  if (
    previousConnection
    && connectionStartedAt - previousConnection.startedAt < SESSION_RECONNECT_COOLDOWN_MS
  ) {
    return NextResponse.json({ error: "Realtime reconnecting too quickly" }, { status: 429 });
  }
  const connectionAttempt: RealtimeConnectionState = {
    startedAt: connectionStartedAt,
    status: "connecting",
  };
  recentConnections.set(sessionId, connectionAttempt);

  const sessionConfig = {
    type: "realtime",
    model: config.openai.realtimeModel,
    instructions: buildRealtimeInstructions(session),
    output_modalities: ["audio"],
    audio: {
      input: {
        transcription: {
          model: config.openai.realtimeTranscriptionModel,
          prompt: "English conversation practice. The learner may switch naturally between English and Korean.",
          languages: ["en", "ko"],
          delay: "low",
        },
        // Existing UI is explicit push-to-talk. The client transport must clear,
        // commit, and create a response on press/release instead of auto-VAD.
        turn_detection: null,
      },
      output: { voice: getRealtimeVoice(session.tutorId) },
    },
  };
  const form = new FormData();
  form.set("sdp", sdp);
  form.set("session", JSON.stringify(sessionConfig));

  const controller = new AbortController();
  const abortFromRequest = () => controller.abort(request.signal.reason);
  if (request.signal.aborted) abortFromRequest();
  else request.signal.addEventListener("abort", abortFromRequest, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error("Realtime session timed out")), OPENAI_TIMEOUT_MS);
  let established = false;
  try {
    const response = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.openai.apiKey}` },
      body: form,
      signal: controller.signal,
    });
    const answer = await response.text();
    if (!response.ok) {
      console.error("OpenAI Realtime session failed", { status: response.status });
      return NextResponse.json({ error: "Could not start realtime voice" }, { status: 502 });
    }
    established = true;
    recentConnections.set(sessionId, { startedAt: Date.now(), status: "connected" });
    return new Response(answer, {
      status: 200,
      headers: {
        "Content-Type": "application/sdp",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("OpenAI Realtime connection error", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Could not start realtime voice" }, { status: 502 });
  } finally {
    if (!established && recentConnections.get(sessionId) === connectionAttempt) {
      recentConnections.delete(sessionId);
    }
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", abortFromRequest);
  }
}
