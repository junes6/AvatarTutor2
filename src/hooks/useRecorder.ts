"use client";

// 푸시투토크 녹음 훅.
// MediaRecorder와 브라우저 SpeechRecognition을 함께 사용해 녹음 중 문장을 즉시 보여주고,
// 서버 STT 키가 없을 때도 실제 사용자 발화를 turn API의 text로 전달할 수 있게 한다.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  awaitMediaStreamRequest,
  DEFAULT_MEDIA_REQUEST_TIMEOUT_MS,
  MediaRequestCancelledError,
  MediaRequestTimeoutError,
} from "@/hooks/mediaRequest";
import {
  applySpeechTranscriptEvent,
  canRestartSpeechRecognitionAfterError,
  commitInterimTranscript,
  createLiveTranscriptBuffer,
  getLiveTranscriptSnapshot,
  getNextTranscriptSessionOffset,
  normalizeLiveTranscript,
  resetLiveTranscriptBuffer,
} from "@/hooks/liveTranscript";

interface BrowserSpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface BrowserSpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: BrowserSpeechRecognitionAlternative;
}

interface BrowserSpeechRecognitionResultList {
  readonly length: number;
  [index: number]: BrowserSpeechRecognitionResult;
}

interface BrowserSpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: BrowserSpeechRecognitionResultList;
}

interface BrowserSpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message?: string;
}

interface BrowserSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

declare global {
  interface Window {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  }
}

export type RecorderPhase = "idle" | "requesting" | "recording" | "finalizing" | "error";

export function canStartRecording(phase: RecorderPhase): boolean {
  return phase === "idle" || phase === "error";
}

export type RecorderErrorCode =
  | "unsupported"
  | "permission-denied"
  | "permission-timeout"
  | "device-not-found"
  | "device-busy"
  | "recording-failed";

export interface RecorderError {
  code: RecorderErrorCode;
  message: string;
}

export interface RecorderResult {
  blob: Blob;
  durationSec: number;
  mimeType: string;
  /** 브라우저가 인식한 실제 사용자 발화(확정 결과 + 종료 시점의 마지막 중간 결과). */
  transcript?: string;
  transcriptConfidence?: number;
  speechDetected: boolean;
}

export interface UseRecorderOptions {
  language?: string;
  enableBrowserTranscript?: boolean;
  minDurationSec?: number;
  transcriptGraceMs?: number;
  permissionRequestTimeoutMs?: number;
}

const MIME_CANDIDATES = [
  // Firefox 등 OGG Opus를 제공하는 브라우저에서는 Azure 발음평가와 호환되는
  // 실제 컨테이너를 우선한다. Chrome(WebM)/Safari(MP4)는 STT+유사도 폴백을 쓴다.
  "audio/ogg;codecs=opus",
  "audio/webm;codecs=opus",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/webm",
] as const;

const DEFAULT_MIN_DURATION_SEC = 0.25;
const DEFAULT_TRANSCRIPT_GRACE_MS = 450;
const SPEECH_LEVEL_THRESHOLD = 0.035;

function getSupportedMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

function recorderErrorFrom(error: unknown): RecorderError {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return { code: "permission-denied", message: "마이크 권한이 필요해요. 브라우저 설정에서 허용해 주세요." };
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return { code: "device-not-found", message: "사용할 수 있는 마이크를 찾지 못했어요." };
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return { code: "device-busy", message: "마이크를 다른 앱이 사용 중이에요." };
  }
  return { code: "recording-failed", message: "녹음을 시작하지 못했어요. 잠시 후 다시 시도해 주세요." };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function useRecorder(options: UseRecorderOptions = {}) {
  const language = options.language ?? "en-US";
  const enableBrowserTranscript = options.enableBrowserTranscript ?? true;
  const minDurationSec = options.minDurationSec ?? DEFAULT_MIN_DURATION_SEC;
  const transcriptGraceMs = options.transcriptGraceMs ?? DEFAULT_TRANSCRIPT_GRACE_MS;
  const permissionRequestTimeoutMs = options.permissionRequestTimeoutMs ?? DEFAULT_MEDIA_REQUEST_TIMEOUT_MS;

  const [phase, setPhase] = useState<RecorderPhase>("idle");
  const [level, setLevel] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [hasDetectedSpeech, setHasDetectedSpeech] = useState(false);
  const [isSpeechRecognitionSupported, setIsSpeechRecognitionSupported] = useState(false);
  const [error, setError] = useState<RecorderError | null>(null);

  const phaseRef = useRef<RecorderPhase>("idle");
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startTimeRef = useRef(0);
  const rafRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const liveTranscriptBufferRef = useRef(createLiveTranscriptBuffer());
  const recognitionSessionOffsetRef = useRef(0);
  const recognitionMayRestartRef = useRef(true);
  const recognitionDoneRef = useRef<Promise<void> | null>(null);
  const resolveRecognitionDoneRef = useRef<(() => void) | null>(null);
  const startPromiseRef = useRef<Promise<boolean> | null>(null);
  const mediaRequestAbortRef = useRef<AbortController | null>(null);
  const stopPromiseRef = useRef<Promise<RecorderResult | null> | null>(null);
  const resolveStopRef = useRef<((result: RecorderResult | null) => void) | null>(null);
  const operationRef = useRef(0);
  const canceledRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const mountedRef = useRef(true);
  const voicedFramesRef = useRef(0);
  const peakLevelRef = useRef(0);
  const lastLevelPaintRef = useRef(0);

  const safeSetPhase = useCallback((next: RecorderPhase) => {
    phaseRef.current = next;
    if (mountedRef.current) setPhase(next);
  }, []);

  const resolveRecognitionDone = useCallback(() => {
    resolveRecognitionDoneRef.current?.();
    resolveRecognitionDoneRef.current = null;
  }, []);

  const stopRecognition = useCallback(
    (abort = false) => {
      const recognition = recognitionRef.current;
      recognitionRef.current = null;
      if (!recognition) {
        resolveRecognitionDone();
        return;
      }
      try {
        if (abort) {
          recognition.onresult = null;
          recognition.onerror = null;
          recognition.onend = null;
          recognition.abort();
          resolveRecognitionDone();
        } else {
          // stop() 뒤에도 마지막 final result가 도착할 수 있으므로 핸들러를 유지한다.
          recognition.stop();
        }
      } catch {
        resolveRecognitionDone();
      }
    },
    [resolveRecognitionDone],
  );

  const releaseMediaResources = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    const audioContext = audioCtxRef.current;
    audioCtxRef.current = null;
    if (audioContext && audioContext.state !== "closed") audioContext.close().catch(() => {});
    mediaRef.current = null;
    if (mountedRef.current) setLevel(0);
  }, []);

  const resetTranscript = useCallback(() => {
    resetLiveTranscriptBuffer(liveTranscriptBufferRef.current);
    if (mountedRef.current) {
      setTranscript("");
      setInterimTranscript("");
      setHasDetectedSpeech(false);
    }
  }, []);

  const startSpeechRecognition = useCallback(
    (operationId: number) => {
      if (!enableBrowserTranscript) return;
      const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
      if (!Recognition) return;

      const recognition = new Recognition();
      recognitionRef.current = recognition;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = language;
      recognition.maxAlternatives = 1;
      recognitionDoneRef.current = new Promise<void>((resolve) => {
        resolveRecognitionDoneRef.current = resolve;
      });

      recognition.onresult = (event) => {
        if (operationId !== operationRef.current || canceledRef.current) return;
        const snapshot = applySpeechTranscriptEvent(
          liveTranscriptBufferRef.current,
          event,
          recognitionSessionOffsetRef.current,
        );
        if (mountedRef.current) {
          setTranscript(snapshot.finalTranscript);
          setInterimTranscript(snapshot.interimTranscript);
          if (snapshot.liveTranscript) setHasDetectedSpeech(true);
        }
      };
      recognition.onerror = (event) => {
        // 브라우저 보조 STT 실패는 원본 녹음/서버 STT를 막지 않는다.
        recognitionMayRestartRef.current = canRestartSpeechRecognitionAfterError(event.error);
        if (!recognitionMayRestartRef.current) {
          recognitionRef.current = null;
          resolveRecognitionDone();
        }
      };
      recognition.onend = () => {
        recognitionRef.current = null;
        const shouldRestart =
          operationId === operationRef.current &&
          !canceledRef.current &&
          !stopRequestedRef.current &&
          recognitionMayRestartRef.current &&
          mediaRef.current?.state === "recording";
        if (!shouldRestart) {
          resolveRecognitionDone();
          return;
        }
        const committed = commitInterimTranscript(liveTranscriptBufferRef.current);
        recognitionSessionOffsetRef.current = getNextTranscriptSessionOffset(liveTranscriptBufferRef.current);
        if (mountedRef.current) {
          setTranscript(committed.finalTranscript);
          setInterimTranscript("");
        }
        window.setTimeout(() => {
          if (
            operationId !== operationRef.current ||
            canceledRef.current ||
            stopRequestedRef.current ||
            mediaRef.current?.state !== "recording"
          ) {
            resolveRecognitionDone();
            return;
          }
          recognitionRef.current = recognition;
          try {
            recognition.start();
          } catch {
            recognitionRef.current = null;
            resolveRecognitionDone();
          }
        }, 80);
      };

      try {
        recognitionMayRestartRef.current = true;
        recognition.start();
      } catch {
        recognitionRef.current = null;
        resolveRecognitionDone();
      }
    },
    [enableBrowserTranscript, language, resolveRecognitionDone],
  );

  const startLevelMeter = useCallback((stream: MediaStream, operationId: number) => {
    const AudioContextCtor = window.AudioContext;
    if (!AudioContextCtor) return;
    try {
      const context = new AudioContextCtor();
      audioCtxRef.current = context;
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.65;
      source.connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      let smoothedLevel = 0;

      const loop = (timestamp: number) => {
        if (operationId !== operationRef.current || !mediaRef.current) return;
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (let i = 0; i < samples.length; i++) {
          const value = (samples[i] - 128) / 128;
          sum += value * value;
        }
        const rms = Math.sqrt(sum / samples.length);
        const normalized = Math.min(1, rms * 5);
        smoothedLevel = smoothedLevel * 0.65 + normalized * 0.35;
        peakLevelRef.current = Math.max(peakLevelRef.current, rms);
        if (rms >= SPEECH_LEVEL_THRESHOLD) {
          voicedFramesRef.current += 1;
          if (voicedFramesRef.current >= 3 && mountedRef.current) setHasDetectedSpeech(true);
        }
        // 60fps 전체 리렌더를 피하면서 파형은 충분히 부드럽게 유지한다.
        if (timestamp - lastLevelPaintRef.current >= 50 && mountedRef.current) {
          lastLevelPaintRef.current = timestamp;
          setLevel(smoothedLevel);
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
      context.resume().catch(() => {});
    } catch {
      // 파형 분석 실패는 원본 MediaRecorder 녹음을 막지 않는다.
      audioCtxRef.current = null;
    }
  }, []);

  const buildResult = useCallback(
    async (recorder: MediaRecorder, durationSec: number): Promise<RecorderResult | null> => {
      if (recognitionDoneRef.current) {
        await Promise.race([recognitionDoneRef.current, wait(transcriptGraceMs)]);
      }
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
      const snapshot = getLiveTranscriptSnapshot(liveTranscriptBufferRef.current);
      const browserTranscript = snapshot.liveTranscript;
      const speechDetected =
        voicedFramesRef.current >= 3 || peakLevelRef.current >= SPEECH_LEVEL_THRESHOLD || !!browserTranscript;

      if (canceledRef.current || durationSec < minDurationSec || blob.size === 0) return null;
      return {
        blob,
        durationSec,
        mimeType: blob.type || recorder.mimeType || "audio/webm",
        transcript: browserTranscript || undefined,
        transcriptConfidence: snapshot.confidence,
        speechDetected,
      };
    },
    [minDurationSec, transcriptGraceMs],
  );

  const start = useCallback(async (): Promise<boolean> => {
    // React state 반영보다 빠르게 재진입할 수 있으므로 ref 기반 phase를 먼저 검사한다.
    // 특히 finalizing 중 chunks/transcript refs가 새 녹음에 의해 초기화되면 안 된다.
    if (!canStartRecording(phaseRef.current) || startPromiseRef.current || stopPromiseRef.current) {
      return false;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      const nextError: RecorderError = { code: "unsupported", message: "이 브라우저는 음성 녹음을 지원하지 않아요." };
      setError(nextError);
      safeSetPhase("error");
      return false;
    }

    const operationId = ++operationRef.current;
    canceledRef.current = false;
    stopRequestedRef.current = false;
    chunksRef.current = [];
    voicedFramesRef.current = 0;
    peakLevelRef.current = 0;
    lastLevelPaintRef.current = 0;
    recognitionDoneRef.current = null;
    resolveRecognitionDoneRef.current = null;
    recognitionSessionOffsetRef.current = 0;
    resetTranscript();
    setError(null);
    safeSetPhase("requesting");

    const begin = async () => {
      const mediaRequestController = new AbortController();
      mediaRequestAbortRef.current = mediaRequestController;
      try {
        const stream = await awaitMediaStreamRequest(
          navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              channelCount: 1,
            },
          }),
          { signal: mediaRequestController.signal, timeoutMs: permissionRequestTimeoutMs },
        );
        if (operationId !== operationRef.current || canceledRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          safeSetPhase("idle");
          return false;
        }
        streamRef.current = stream;

        const mimeType = getSupportedMimeType();
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        mediaRef.current = recorder;
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunksRef.current.push(event.data);
        };
        recorder.onerror = () => {
          canceledRef.current = true;
          setError({ code: "recording-failed", message: "녹음 중 문제가 생겼어요. 다시 시도해 주세요." });
          safeSetPhase("error");
          if (recorder.state !== "inactive") {
            try {
              recorder.stop();
            } catch {}
          }
        };
        recorder.onstop = async () => {
          const durationSec = Math.max(0, (performance.now() - startTimeRef.current) / 1000);
          stopRecognition(canceledRef.current);
          const result = await buildResult(recorder, durationSec);
          releaseMediaResources();
          recognitionDoneRef.current = null;
          stopPromiseRef.current = null;
          const resolve = resolveStopRef.current;
          resolveStopRef.current = null;
          safeSetPhase("idle");
          resolve?.(result);
        };

        startTimeRef.current = performance.now();
        recorder.start(100);
        startLevelMeter(stream, operationId);
        startSpeechRecognition(operationId);
        safeSetPhase("recording");
        return true;
      } catch (caught) {
        if (operationId === operationRef.current) {
          const nextError: RecorderError = caught instanceof MediaRequestTimeoutError
            ? {
                code: "permission-timeout",
                message: "마이크 권한 응답이 없어 연결을 취소했어요. 다시 눌러 시도해 주세요.",
              }
            : recorderErrorFrom(caught);
          setError(nextError);
          safeSetPhase("error");
          releaseMediaResources();
        }
        return false;
      } finally {
        if (mediaRequestAbortRef.current === mediaRequestController) {
          mediaRequestAbortRef.current = null;
        }
      }
    };

    const promise = begin();
    startPromiseRef.current = promise;
    try {
      return await promise;
    } finally {
      if (startPromiseRef.current === promise) startPromiseRef.current = null;
    }
  }, [buildResult, permissionRequestTimeoutMs, releaseMediaResources, resetTranscript, safeSetPhase, startLevelMeter, startSpeechRecognition, stopRecognition]);

  /** 녹음 종료 → 브라우저 최종 transcript를 잠깐 기다린 뒤 결과 반환한다. */
  const stop = useCallback(async (): Promise<RecorderResult | null> => {
    if (stopPromiseRef.current) return stopPromiseRef.current;
    stopRequestedRef.current = true;
    if (phaseRef.current === "requesting") {
      canceledRef.current = true;
      operationRef.current += 1;
      mediaRequestAbortRef.current?.abort(new MediaRequestCancelledError());
      mediaRequestAbortRef.current = null;
      stopRecognition(true);
      releaseMediaResources();
      safeSetPhase("idle");
      return null;
    }
    if (startPromiseRef.current) {
      const started = await startPromiseRef.current;
      if (!started) return null;
    }

    const recorder = mediaRef.current;
    if (!recorder || recorder.state === "inactive") {
      stopRecognition(false);
      releaseMediaResources();
      safeSetPhase("idle");
      return null;
    }

    safeSetPhase("finalizing");
    const promise = new Promise<RecorderResult | null>((resolve) => {
      resolveStopRef.current = resolve;
      try {
        recorder.requestData();
      } catch {}
      try {
        recorder.stop();
      } catch {
        resolveStopRef.current = null;
        releaseMediaResources();
        safeSetPhase("idle");
        resolve(null);
      }
    });
    stopPromiseRef.current = promise;
    return promise;
  }, [releaseMediaResources, safeSetPhase, stopRecognition]);

  const cancel = useCallback(() => {
    canceledRef.current = true;
    stopRequestedRef.current = true;
    operationRef.current += 1;
    resetTranscript();
    mediaRequestAbortRef.current?.abort(new MediaRequestCancelledError());
    mediaRequestAbortRef.current = null;
    stopRecognition(true);
    const recorder = mediaRef.current;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        releaseMediaResources();
        safeSetPhase("idle");
      }
    } else {
      releaseMediaResources();
      safeSetPhase("idle");
    }
  }, [releaseMediaResources, resetTranscript, safeSetPhase, stopRecognition]);

  useEffect(() => {
    mountedRef.current = true;
    const supportCheckFrame = requestAnimationFrame(() => {
      setIsSpeechRecognitionSupported(
        enableBrowserTranscript && !!(window.SpeechRecognition || window.webkitSpeechRecognition),
      );
    });
    return () => {
      cancelAnimationFrame(supportCheckFrame);
      mountedRef.current = false;
      canceledRef.current = true;
      operationRef.current += 1;
      mediaRequestAbortRef.current?.abort(new MediaRequestCancelledError());
      mediaRequestAbortRef.current = null;
      stopRecognition(true);
      const recorder = mediaRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        try {
          recorder.stop();
        } catch {}
      }
      resolveStopRef.current?.(null);
      resolveStopRef.current = null;
      releaseMediaResources();
    };
  }, [enableBrowserTranscript, releaseMediaResources, stopRecognition]);

  return {
    start,
    stop,
    cancel,
    resetTranscript,
    isRecording: phase === "recording",
    isFinalizing: phase === "finalizing",
    phase,
    level,
    transcript,
    interimTranscript,
    liveTranscript: normalizeLiveTranscript(`${transcript} ${interimTranscript}`),
    hasDetectedSpeech,
    isSpeechRecognitionSupported,
    error,
  };
}
