"use client";

// 튜터 음성 재생 훅 — 서버 TTS(mp3 base64) 재생, 없으면 브라우저 speechSynthesis 폴백.
// 마지막 발화를 저장해 "방금 뭐라고?" 즉시 재생과 0.7배속을 지원한다.

import { useCallback, useEffect, useRef, useState } from "react";

export interface PlayableAudio {
  audioBase64: string;
  mime: string;
}

interface LastSpoken {
  audio: PlayableAudio | null;
  text: string;
}

export function useAudioPlayer() {
  const [speaking, setSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastRef = useRef<LastSpoken>({ audio: null, text: "" });
  const onEndRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const el = new Audio();
    audioRef.current = el;
    const onEnd = () => {
      setSpeaking(false);
      onEndRef.current?.();
      onEndRef.current = null;
    };
    el.addEventListener("ended", onEnd);
    el.addEventListener("error", onEnd);
    return () => {
      el.pause();
      el.removeEventListener("ended", onEnd);
      el.removeEventListener("error", onEnd);
      window.speechSynthesis?.cancel();
    };
  }, []);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    if (audioRef.current) audioRef.current.currentTime = 0;
    window.speechSynthesis?.cancel();
    setSpeaking(false);
    onEndRef.current = null;
  }, []);

  const speakText = useCallback((text: string, rate: number) => {
    if (!window.speechSynthesis) {
      setSpeaking(false);
      onEndRef.current?.();
      return;
    }
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "en-US";
    utter.rate = rate;
    const voice = window.speechSynthesis.getVoices().find((v) => v.lang.startsWith("en"));
    if (voice) utter.voice = voice;
    utter.onend = () => {
      setSpeaking(false);
      onEndRef.current?.();
      onEndRef.current = null;
    };
    window.speechSynthesis.speak(utter);
  }, []);

  /** 튜터 발화 재생. audio가 null이면 브라우저 TTS 폴백 */
  const play = useCallback(
    (audio: PlayableAudio | null, text: string, opts: { rate?: number; onEnd?: () => void } = {}) => {
      stop();
      const rate = opts.rate ?? 1.0;
      lastRef.current = { audio, text };
      onEndRef.current = opts.onEnd ?? null;
      setSpeaking(true);
      if (audio && audioRef.current) {
        audioRef.current.src = `data:${audio.mime};base64,${audio.audioBase64}`;
        audioRef.current.playbackRate = rate;
        audioRef.current.play().catch(() => {
          // 자동재생 차단 등 → 텍스트 폴백
          speakText(text, rate);
        });
      } else {
        speakText(text, rate);
      }
    },
    [stop, speakText],
  );

  /** 직전 튜터 발화 다시 재생 ("방금 뭐라고?" / 0.7배속) */
  const replayLast = useCallback(
    (rate = 1.0) => {
      const last = lastRef.current;
      if (!last.text && !last.audio) return;
      play(last.audio, last.text, { rate });
    },
    [play],
  );

  /** 임의 blob 재생 (내 발화 다시듣기) */
  const playBlob = useCallback(
    (blob: Blob, rate = 1.0) => {
      stop();
      if (!audioRef.current) return;
      setSpeaking(true);
      audioRef.current.src = URL.createObjectURL(blob);
      audioRef.current.playbackRate = rate;
      audioRef.current.play().catch(() => setSpeaking(false));
    },
    [stop],
  );

  return { play, playBlob, replayLast, stop, speaking, hasLast: () => !!lastRef.current.text };
}

/** 표현 카드 등의 "듣기" — /api/tts 호출 후 재생 (모듈 수준 헬퍼) */
export async function fetchTTS(text: string, tutorId: string, speed = 1.0): Promise<PlayableAudio | null> {
  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, tutorId, speed }),
    });
    const data = await res.json();
    return data.audio ?? null;
  } catch {
    return null;
  }
}
