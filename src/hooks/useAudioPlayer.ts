"use client";

// 튜터 음성 재생 훅.
// 서버 TTS가 없을 때도 튜터별 언어권/피치/속도 프로필을 유지하고,
// 모든 훅 인스턴스에서 한 번에 하나의 음성만 재생되도록 조정한다.

import { useCallback, useEffect, useRef, useState } from "react";

export interface PlayableAudio {
  audioBase64: string;
  mime: string;
  provider?: "openai" | "elevenlabs";
  voiceId?: string;
}

export type AudioPlaybackPhase = "idle" | "loading" | "playing";

export interface BrowserVoiceProfile {
  lang: string;
  nameHints: readonly string[];
  pitch: number;
  rate: number;
}

interface LastSpoken {
  audio: PlayableAudio | null;
  text: string;
  tutorId: string;
  fallbackRate: number;
}

export interface PlayOptions {
  rate?: number;
  /** 서버가 계산한 레벨×사용자 설정 속도. provider 오디오에는 이미 반영되어 브라우저 폴백에만 사용한다. */
  fallbackRate?: number;
  onEnd?: () => void;
  tutorId?: string;
}

export interface AudioPlaybackArbiter {
  claim: (owner: symbol, stop: () => void) => void;
  release: (owner: symbol) => void;
  stop: () => void;
  owns: (owner: symbol) => boolean;
}

export interface FetchTTSOptions {
  signal?: AbortSignal;
}

export interface FetchedTTS {
  audio: PlayableAudio | null;
  fallbackRate: number;
}

const DEFAULT_TUTOR_ID = "default";
const PLAYBACK_RATE_MIN = 0.5;
const PLAYBACK_RATE_MAX = 2;

// 이름 힌트는 macOS/iOS, Windows, Android/Chrome에서 흔한 시스템 음성을 함께 포함한다.
// 일치하는 이름이 없어도 lang + pitch/rate가 적용되므로 캐릭터 차이는 유지된다.
const BROWSER_VOICE_PROFILES: Readonly<Record<string, BrowserVoiceProfile>> = {
  mia: {
    lang: "en-US",
    nameHints: ["samantha", "ava", "jenny", "aria", "zira", "google us english"],
    pitch: 1.12,
    rate: 1.03,
  },
  oliver: {
    lang: "en-GB",
    nameHints: ["daniel", "ryan", "george", "oliver", "google uk english male"],
    pitch: 0.88,
    rate: 0.94,
  },
  jack: {
    lang: "en-AU",
    nameHints: ["lee", "william", "gordon", "karen", "google australian english"],
    pitch: 0.97,
    rate: 1.08,
  },
};

const DEFAULT_BROWSER_PROFILE: BrowserVoiceProfile = {
  lang: "en-US",
  nameHints: ["google us english", "samantha", "zira"],
  pitch: 1,
  rate: 1,
};

const selectedVoiceCache = new Map<string, SpeechSynthesisVoice | null>();

/**
 * 여러 플레이어가 하나의 음성 재생권을 공유하게 한다. 새 요청은 실제 재생뿐 아니라
 * TTS를 내려받는 중인 이전 요청도 즉시 중단하므로, 늦은 응답이 뒤늦게 재생되지 않는다.
 */
export function createAudioPlaybackArbiter(): AudioPlaybackArbiter {
  let active: { owner: symbol; stop: () => void } | null = null;

  return {
    claim(owner, stop) {
      if (active?.owner !== owner) {
        const previous = active;
        previous?.stop();
        if (active?.owner === previous?.owner) active = null;
      }
      active = { owner, stop };
    },
    release(owner) {
      if (active?.owner === owner) active = null;
    },
    stop() {
      const previous = active;
      previous?.stop();
      if (active?.owner === previous?.owner) active = null;
    },
    owns(owner) {
      return active?.owner === owner;
    },
  };
}

const globalPlaybackArbiter = createAudioPlaybackArbiter();

/** 녹음을 시작하기 전처럼 현재 종류와 무관하게 모든 음성 재생을 멈춰야 할 때 사용한다. */
export function stopGlobalAudioPlayback(): void {
  globalPlaybackArbiter.stop();
  // 이전 버전이나 브라우저 자체 TTS에서 남은 발화도 녹음에 섞이지 않게 정리한다.
  if (typeof window !== "undefined") window.speechSynthesis?.cancel();
}

function clampRate(rate: number): number {
  return Math.min(PLAYBACK_RATE_MAX, Math.max(PLAYBACK_RATE_MIN, rate));
}

export function combineBrowserFallbackRate(requestedRate = 1, adaptiveRate = 1): number {
  return Math.round(clampRate(clampRate(requestedRate) * clampRate(adaptiveRate)) * 1000) / 1000;
}

function normalizedTutorId(tutorId?: string): string {
  return tutorId?.trim().toLowerCase() || DEFAULT_TUTOR_ID;
}

export function getBrowserVoiceProfile(tutorId?: string): BrowserVoiceProfile {
  return BROWSER_VOICE_PROFILES[normalizedTutorId(tutorId)] ?? DEFAULT_BROWSER_PROFILE;
}

function stableHash(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return hash;
}

/** 브라우저/OS가 제공한 음성 중 튜터 프로필에 가장 잘 맞는 음성을 결정한다. */
export function selectBrowserVoice(
  tutorId: string | undefined,
  voices: readonly SpeechSynthesisVoice[],
): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  const id = normalizedTutorId(tutorId);
  const profile = getBrowserVoiceProfile(id);
  const targetLang = profile.lang.toLowerCase();
  const targetBaseLang = targetLang.split("-")[0];

  const scored = voices
    .map((voice, index) => {
      const name = voice.name.toLowerCase();
      const lang = voice.lang.toLowerCase();
      const hintIndex = profile.nameHints.findIndex((hint) => name.includes(hint));
      let score = 0;
      if (lang === targetLang) score += 100;
      else if (lang.split("-")[0] === targetBaseLang) score += 35;
      if (hintIndex >= 0) score += 80 - hintIndex;
      if (voice.localService) score += 2;
      if (voice.default) score += 1;
      return { voice, score, index };
    })
    .filter(({ voice }) => voice.lang.toLowerCase().startsWith(targetBaseLang))
    .sort((a, b) => b.score - a.score || a.voice.name.localeCompare(b.voice.name));

  if (scored.length === 0) return voices[stableHash(id) % voices.length] ?? null;
  const bestScore = scored[0].score;
  const best = scored.filter((item) => item.score === bestScore);
  return best[stableHash(id) % best.length]?.voice ?? scored[0].voice;
}

function resolveBrowserVoice(tutorId?: string): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const id = normalizedTutorId(tutorId);
  if (selectedVoiceCache.has(id)) return selectedVoiceCache.get(id) ?? null;
  const voices = window.speechSynthesis.getVoices();
  const voice = selectBrowserVoice(id, voices);
  // getVoices()가 초기 로딩 중 빈 배열이면 캐시하지 않는다.
  if (voices.length > 0) selectedVoiceCache.set(id, voice);
  return voice;
}

/** 카드/힌트 등 훅 밖의 브라우저 TTS도 통화 음성과 같은 튜터 프로필을 쓰게 한다. */
export function configureBrowserUtterance(
  utterance: SpeechSynthesisUtterance,
  tutorId?: string,
  rate = 1,
): SpeechSynthesisUtterance {
  const profile = getBrowserVoiceProfile(tutorId);
  utterance.lang = profile.lang;
  utterance.rate = clampRate(rate * profile.rate);
  utterance.pitch = profile.pitch;
  const voice = resolveBrowserVoice(tutorId);
  if (voice) utterance.voice = voice;
  return utterance;
}

export function useAudioPlayer(tutorId?: string) {
  const activeTutorId = normalizedTutorId(tutorId);
  const [speaking, setSpeaking] = useState(false);
  const [phase, setPhase] = useState<AudioPlaybackPhase>("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ownerRef = useRef(Symbol("audio-player"));
  const lastRef = useRef<LastSpoken>({ audio: null, text: "", tutorId: activeTutorId, fallbackRate: 1 });
  const onEndRef = useRef<(() => void) | null>(null);
  const playbackIdRef = useRef(0);
  const objectUrlRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const stopRef = useRef<() => void>(() => {});
  const fallbackStartedRef = useRef<number | null>(null);
  const fetchAbortRef = useRef<AbortController | null>(null);

  const revokeObjectUrl = useCallback(() => {
    if (!objectUrlRef.current) return;
    URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
  }, []);

  const completePlayback = useCallback(
    (playbackId: number) => {
      if (playbackId !== playbackIdRef.current) return;
      globalPlaybackArbiter.release(ownerRef.current);
      fallbackStartedRef.current = null;
      if (mountedRef.current) {
        setSpeaking(false);
        setPhase("idle");
      }
      const onEnd = onEndRef.current;
      onEndRef.current = null;
      revokeObjectUrl();
      onEnd?.();
    },
    [revokeObjectUrl],
  );

  const stop = useCallback(() => {
    const ownsGlobalPlayback = globalPlaybackArbiter.owns(ownerRef.current);
    playbackIdRef.current += 1;
    fallbackStartedRef.current = null;
    fetchAbortRef.current?.abort();
    fetchAbortRef.current = null;
    const el = audioRef.current;
    if (el) {
      el.onended = null;
      el.onerror = null;
      el.onplaying = null;
      el.pause();
      el.removeAttribute("src");
      el.load();
    }
    if (ownsGlobalPlayback && typeof window !== "undefined") window.speechSynthesis?.cancel();
    globalPlaybackArbiter.release(ownerRef.current);
    onEndRef.current = null;
    revokeObjectUrl();
    if (mountedRef.current) {
      setSpeaking(false);
      setPhase("idle");
    }
  }, [revokeObjectUrl]);

  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  useEffect(() => {
    mountedRef.current = true;
    const el = new Audio();
    el.preload = "auto";
    audioRef.current = el;

    const synth = window.speechSynthesis;
    const handleVoicesChanged = () => selectedVoiceCache.clear();
    synth?.addEventListener?.("voiceschanged", handleVoicesChanged);
    // 일부 브라우저는 첫 호출이 빈 목록이고 두 번째 호출부터 음성을 반환한다.
    synth?.getVoices();

    return () => {
      mountedRef.current = false;
      stopRef.current();
      synth?.removeEventListener?.("voiceschanged", handleVoicesChanged);
      audioRef.current = null;
    };
  }, []);

  const speakText = useCallback(
    (text: string, rate: number, playbackId: number, activeTutorId: string) => {
      if (playbackId !== playbackIdRef.current) return;
      const synth = window.speechSynthesis;
      if (!synth || typeof SpeechSynthesisUtterance === "undefined") {
        completePlayback(playbackId);
        return;
      }

      const utterance = configureBrowserUtterance(
        new SpeechSynthesisUtterance(text),
        activeTutorId,
        rate,
      );
      utterance.onstart = () => {
        if (playbackId === playbackIdRef.current && mountedRef.current) setPhase("playing");
      };
      utterance.onend = () => completePlayback(playbackId);
      utterance.onerror = () => completePlayback(playbackId);
      try {
        synth.cancel();
        synth.speak(utterance);
      } catch {
        completePlayback(playbackId);
      }
    },
    [completePlayback],
  );

  /** 튜터 발화 재생. audio가 null이거나 디코딩 실패면 튜터별 브라우저 TTS로 폴백한다. */
  const play = useCallback(
    (audio: PlayableAudio | null, text: string, opts: PlayOptions = {}) => {
      stop();
      if (!audio && !text.trim()) {
        opts.onEnd?.();
        return;
      }
      const playbackId = ++playbackIdRef.current;
      const playbackTutorId = normalizedTutorId(opts.tutorId ?? activeTutorId);
      const rate = clampRate(opts.rate ?? 1);
      const fallbackRate = clampRate(opts.fallbackRate ?? 1);
      const browserRate = combineBrowserFallbackRate(rate, fallbackRate);
      lastRef.current = { audio, text, tutorId: playbackTutorId, fallbackRate };
      onEndRef.current = opts.onEnd ?? null;
      globalPlaybackArbiter.claim(ownerRef.current, () => stopRef.current());
      setSpeaking(true);
      setPhase("loading");

      const fallbackToSpeech = () => {
        if (playbackId !== playbackIdRef.current || fallbackStartedRef.current === playbackId) return;
        fallbackStartedRef.current = playbackId;
        const el = audioRef.current;
        if (el) {
          el.onended = null;
          el.onerror = null;
          el.pause();
          el.removeAttribute("src");
          el.load();
        }
        speakText(text, browserRate, playbackId, playbackTutorId);
      };

      const el = audioRef.current;
      if (!audio || !el) {
        fallbackToSpeech();
        return;
      }

      el.src = `data:${audio.mime};base64,${audio.audioBase64}`;
      el.playbackRate = rate;
      el.onplaying = () => {
        if (playbackId === playbackIdRef.current && mountedRef.current) setPhase("playing");
      };
      el.onended = () => completePlayback(playbackId);
      el.onerror = fallbackToSpeech;
      el.play().catch(fallbackToSpeech);
    },
    [activeTutorId, completePlayback, speakText, stop],
  );

  /** 직전 튜터 발화 다시 재생 (일반/느리게). */
  const replayLast = useCallback(
    (rate = 1) => {
      const last = lastRef.current;
      if (!last.text && !last.audio) return;
      play(last.audio, last.text, { rate, tutorId: last.tutorId, fallbackRate: last.fallbackRate });
    },
    [play],
  );

  /**
   * TTS 요청부터 재생 종료까지 하나의 전역 재생 수명주기로 관리한다.
   * 다른 플레이어가 재생권을 가져가면 진행 중인 fetch도 abort되어 늦은 중복 재생을 막는다.
   */
  const playTTS = useCallback(
    async (text: string, opts: PlayOptions = {}): Promise<boolean> => {
      stop();
      const spokenText = text.trim();
      if (!spokenText) {
        opts.onEnd?.();
        return false;
      }

      const requestId = ++playbackIdRef.current;
      const playbackTutorId = normalizedTutorId(opts.tutorId ?? activeTutorId);
      const controller = new AbortController();
      fetchAbortRef.current = controller;
      globalPlaybackArbiter.claim(ownerRef.current, () => stopRef.current());
      if (mountedRef.current) {
        setSpeaking(true);
        setPhase("loading");
      }

      const fetched = await fetchTTS(spokenText, playbackTutorId, 1, { signal: controller.signal });
      if (fetchAbortRef.current === controller) fetchAbortRef.current = null;
      if (
        controller.signal.aborted ||
        requestId !== playbackIdRef.current ||
        !globalPlaybackArbiter.owns(ownerRef.current)
      ) {
        return false;
      }

      play(fetched?.audio ?? null, spokenText, {
        ...opts,
        tutorId: playbackTutorId,
        fallbackRate: fetched?.fallbackRate ?? 1,
      });
      return true;
    },
    [activeTutorId, play, stop],
  );

  /** 임의 blob 재생 (내 발화 다시듣기). 생성한 object URL은 종료/중단 시 회수한다. */
  const playBlob = useCallback(
    (blob: Blob, rate = 1, onEnd?: () => void) => {
      stop();
      const el = audioRef.current;
      if (!el) return;
      const playbackId = ++playbackIdRef.current;
      objectUrlRef.current = URL.createObjectURL(blob);
      onEndRef.current = onEnd ?? null;
      globalPlaybackArbiter.claim(ownerRef.current, () => stopRef.current());
      setSpeaking(true);
      setPhase("loading");
      el.src = objectUrlRef.current;
      el.playbackRate = clampRate(rate);
      el.onplaying = () => {
        if (playbackId === playbackIdRef.current && mountedRef.current) setPhase("playing");
      };
      el.onended = () => completePlayback(playbackId);
      el.onerror = () => completePlayback(playbackId);
      el.play().catch(() => completePlayback(playbackId));
    },
    [completePlayback, stop],
  );

  return {
    play,
    playTTS,
    playBlob,
    replayLast,
    stop,
    speaking,
    phase,
    hasLast: () => !!lastRef.current.text || !!lastRef.current.audio,
  };
}

/** 표현 카드 등의 "듣기" — /api/tts 호출 후 재생 (모듈 수준 헬퍼). */
export async function fetchTTS(
  text: string,
  tutorId: string,
  speed = 1,
  options: FetchTTSOptions = {},
): Promise<FetchedTTS | null> {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = globalThis.setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, tutorId, speed: clampRate(speed) }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { audio?: PlayableAudio | null; fallbackRate?: number };
    const audio = data.audio;
    const fallbackRate = typeof data.fallbackRate === "number" && Number.isFinite(data.fallbackRate)
      ? clampRate(data.fallbackRate)
      : 1;
    if (!audio || typeof audio.audioBase64 !== "string" || typeof audio.mime !== "string") {
      return { audio: null, fallbackRate };
    }
    return { audio, fallbackRate };
  } catch {
    return null;
  } finally {
    globalThis.clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}
