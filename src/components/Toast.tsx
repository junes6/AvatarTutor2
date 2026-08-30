"use client";

// 전역 토스트 — 조용한 폴백 대신 무슨 일이 있었는지 사용자에게 알린다.

import { useEffect, useState } from "react";

export type ToastTone = "info" | "warn" | "error" | "success";

export interface ToastMessage {
  id: number;
  text: string;
  tone: ToastTone;
}

type Listener = (toast: ToastMessage) => void;

const listeners = new Set<Listener>();
let nextId = 1;

export function showToast(text: string, tone: ToastTone = "info") {
  const toast: ToastMessage = { id: nextId++, text, tone };
  for (const listener of listeners) listener(toast);
}

const TONE_ICON: Record<ToastTone, string> = {
  info: "ℹ️",
  warn: "⚠️",
  error: "⛔",
  success: "✅",
};

const DURATION_MS = 4_200;

export default function ToastHost() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    const listener: Listener = (toast) => {
      setToasts((current) => [...current.slice(-2), toast]);
      window.setTimeout(() => {
        setToasts((current) => current.filter((item) => item.id !== toast.id));
      }, DURATION_MS);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast is-${toast.tone}`}>
          <span aria-hidden="true">{TONE_ICON[toast.tone]}</span>
          <p>{toast.text}</p>
        </div>
      ))}
    </div>
  );
}
