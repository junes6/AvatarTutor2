"use client";

// 푸시투토크 녹음 훅 — 누르는 동안 녹음, 실시간 레벨(파형) 제공

import { useCallback, useRef, useState } from "react";

export interface RecorderResult {
  blob: Blob;
  durationSec: number;
}

export function useRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [level, setLevel] = useState(0); // 0~1 실시간 음량
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startTsRef = useRef(0);
  const rafRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const canceledRef = useRef(false);
  const resolveRef = useRef<((r: RecorderResult | null) => void) | null>(null);

  const cleanup = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setLevel(0);
    setIsRecording(false);
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      canceledRef.current = false;
      chunksRef.current = [];

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : undefined;
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRef.current = rec;
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const durationSec = (Date.now() - startTsRef.current) / 1000;
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        const resolve = resolveRef.current;
        resolveRef.current = null;
        cleanup();
        if (resolve) resolve(canceledRef.current || durationSec < 0.4 ? null : { blob, durationSec });
      };

      // 실시간 레벨 (파형 표시용)
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const loop = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
        rafRef.current = requestAnimationFrame(loop);
      };
      loop();

      startTsRef.current = Date.now();
      rec.start(100);
      setIsRecording(true);
      return true;
    } catch (e) {
      console.error("mic access failed:", e);
      cleanup();
      return false;
    }
  }, [cleanup]);

  /** 녹음 종료 → 결과 반환 (취소되었거나 너무 짧으면 null) */
  const stop = useCallback((): Promise<RecorderResult | null> => {
    return new Promise((resolve) => {
      const rec = mediaRef.current;
      if (!rec || rec.state === "inactive") {
        cleanup();
        resolve(null);
        return;
      }
      resolveRef.current = resolve;
      rec.stop();
    });
  }, [cleanup]);

  const cancel = useCallback(() => {
    canceledRef.current = true;
    const rec = mediaRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    else cleanup();
  }, [cleanup]);

  return { start, stop, cancel, isRecording, level };
}
