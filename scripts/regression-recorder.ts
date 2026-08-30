import assert from "node:assert/strict";
import {
  awaitMediaStreamRequest,
  MediaRequestCancelledError,
  MediaRequestTimeoutError,
} from "../src/hooks/mediaRequest";
import {
  applySpeechTranscriptEvent,
  canRestartSpeechRecognitionAfterError,
  commitInterimTranscript,
  createLiveTranscriptBuffer,
  getLiveTranscriptSnapshot,
  getNextTranscriptSessionOffset,
  resetLiveTranscriptBuffer,
  type SpeechTranscriptResultLike,
} from "../src/hooks/liveTranscript";

function fakeStream() {
  const track = {
    stopCount: 0,
    stop() {
      this.stopCount += 1;
    },
  };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  return { stream, track };
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function recognitionResult(text: string, isFinal: boolean, confidence = 0): SpeechTranscriptResultLike {
  return {
    0: { transcript: text, confidence },
    length: 1,
    isFinal,
  };
}

async function main() {
  {
    const { stream, track } = fakeStream();
    const result = await awaitMediaStreamRequest(Promise.resolve(stream), {
      signal: new AbortController().signal,
      timeoutMs: 50,
    });
    assert.equal(result, stream);
    assert.equal(track.stopCount, 0, "an accepted stream must stay active");
  }

  {
    const { stream, track } = fakeStream();
    let resolveRequest!: (value: MediaStream) => void;
    const request = new Promise<MediaStream>((resolve) => { resolveRequest = resolve; });
    await assert.rejects(
      awaitMediaStreamRequest(request, { signal: new AbortController().signal, timeoutMs: 10 }),
      MediaRequestTimeoutError,
    );
    resolveRequest(stream);
    await wait(0);
    assert.equal(track.stopCount, 1, "a stream approved after timeout must be stopped");
  }

  {
    const { stream, track } = fakeStream();
    let resolveRequest!: (value: MediaStream) => void;
    const request = new Promise<MediaStream>((resolve) => { resolveRequest = resolve; });
    const controller = new AbortController();
    const pending = awaitMediaStreamRequest(request, { signal: controller.signal, timeoutMs: 100 });
    controller.abort();
    await assert.rejects(pending, MediaRequestCancelledError);
    resolveRequest(stream);
    await wait(0);
    assert.equal(track.stopCount, 1, "a stream approved after cancellation must be stopped");
  }

  {
    const buffer = createLiveTranscriptBuffer();
    let snapshot = applySpeechTranscriptEvent(buffer, {
      resultIndex: 0,
      results: { 0: recognitionResult("  I   forgot ", false), length: 1 },
    });
    assert.equal(snapshot.finalTranscript, "");
    assert.equal(snapshot.interimTranscript, "I forgot");
    assert.equal(snapshot.liveTranscript, "I forgot", "interim speech must be visible immediately");

    snapshot = applySpeechTranscriptEvent(buffer, {
      resultIndex: 0,
      results: { 0: recognitionResult("I forgot my passport", false), length: 1 },
    });
    assert.equal(snapshot.liveTranscript, "I forgot my passport", "an interim correction must replace, not append");

    snapshot = applySpeechTranscriptEvent(buffer, {
      resultIndex: 0,
      results: { 0: recognitionResult("I forgot it", false), length: 1 },
    });
    assert.equal(snapshot.liveTranscript, "I forgot it", "stale words from a longer interim result must be removed");

    snapshot = applySpeechTranscriptEvent(buffer, {
      resultIndex: 0,
      results: { 0: recognitionResult("I forgot my passport", true, 0.8), length: 1 },
    });
    assert.equal(snapshot.finalTranscript, "I forgot my passport");
    assert.equal(snapshot.interimTranscript, "");
    assert.equal(snapshot.confidence, 0.8);
  }

  {
    const buffer = createLiveTranscriptBuffer();
    applySpeechTranscriptEvent(buffer, {
      resultIndex: 0,
      results: { 0: recognitionResult("I left it", false), length: 1 },
    });
    const committed = commitInterimTranscript(buffer);
    assert.equal(committed.finalTranscript, "I left it");
    assert.equal(committed.interimTranscript, "");
    const nextOffset = getNextTranscriptSessionOffset(buffer);
    assert.equal(nextOffset, 1);

    const restarted = applySpeechTranscriptEvent(buffer, {
      resultIndex: 0,
      results: { 0: recognitionResult("at home", false), length: 1 },
    }, nextOffset);
    assert.equal(restarted.liveTranscript, "I left it at home", "recognition restarts must not duplicate old interim text");

    resetLiveTranscriptBuffer(buffer);
    assert.deepEqual(getLiveTranscriptSnapshot(buffer), {
      finalTranscript: "",
      interimTranscript: "",
      liveTranscript: "",
      confidence: undefined,
    });
  }

  assert.equal(canRestartSpeechRecognitionAfterError("no-speech"), true);
  for (const fatalError of ["not-allowed", "service-not-allowed", "audio-capture", "network", "aborted"]) {
    assert.equal(
      canRestartSpeechRecognitionAfterError(fatalError),
      false,
      `${fatalError} must fall back to MediaRecorder/server STT without a restart loop`,
    );
  }

  console.log("recorder permission and live transcript regression: ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
