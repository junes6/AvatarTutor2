"use client";

// 실연동이 아니면 상시 배너를 띄운다. 목 모드를 은폐하지 않는 것이 이 앱의 원칙이다.

import { useCallback, useEffect, useRef, useState } from "react";
import type { HealthReport, ProviderHealth } from "@/core/types";
import { showToast } from "./Toast";

const RECHECK_INTERVAL_MS = 5 * 60_000;

const KIND_LABEL: Record<ProviderHealth["kind"], string> = {
  llm: "대화 AI",
  stt: "음성 인식",
  tts: "친구 목소리",
  push: "알림",
  photos: "사진",
};

const STATUS_LABEL: Record<ProviderHealth["status"], string> = {
  live: "연결됨",
  "missing-key": "키 없음",
  "invalid-key": "키 거부됨",
  error: "오류",
  disabled: "미사용",
};

export default function DemoBanner() {
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const bannerRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async (force = false) => {
    setChecking(true);
    try {
      const response = await fetch(`/api/health${force ? "?force=1" : ""}`, { cache: "no-store" });
      const data = (await response.json()) as HealthReport;
      setHealth(data);
      if (force) {
        showToast(data.demo ? "아직 실제 API에 연결되지 않았어요." : "실제 API에 연결됐어요.", data.demo ? "warn" : "success");
      }
    } catch {
      // 상태 확인 자체가 실패해도 앱은 계속 쓸 수 있어야 한다.
      setHealth(null);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => void load());
    const interval = window.setInterval(() => void load(), RECHECK_INTERVAL_MS);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(interval);
    };
  }, [load]);

  // 배너가 차지한 높이를 전역 CSS 변수로 알려, 전체화면 레이아웃이 그만큼 줄어들게 한다.
  useEffect(() => {
    const root = document.documentElement;
    const node = bannerRef.current;
    if (!node) {
      root.style.setProperty("--demo-banner-h", "0px");
      return;
    }
    const apply = () => root.style.setProperty("--demo-banner-h", `${Math.round(node.offsetHeight)}px`);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(node);
    return () => {
      observer.disconnect();
      root.style.setProperty("--demo-banner-h", "0px");
    };
  }, [health?.demo]);

  if (!health || !health.demo) return null;

  return (
    <>
      <button ref={bannerRef} type="button" className="demo-banner" onClick={() => setOpen(true)}>
        <span aria-hidden="true">⚠️</span>
        <span>데모 모드 — API 키가 연결되지 않아 실제 대화가 아닙니다.</span>
        <span className="demo-banner-more">자세히</span>
      </button>

      {open && (
        <div className="sheet-scrim" onClick={() => setOpen(false)}>
          <div
            className="compact-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="demo-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sheet-handle" />
            <h2 id="demo-title" className="text-[19px] font-semibold">연결 상태</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-white/55">
              아래 항목이 실제 호출로 검증된 결과입니다. 대화 AI가 연결되지 않으면 실제 대화가 아닙니다.
            </p>
            <ul className="provider-list">
              {health.providers.map((provider) => (
                <li key={provider.kind} className={`provider-row is-${provider.status}`}>
                  <div>
                    <strong>{KIND_LABEL[provider.kind]}</strong>
                    <small>{provider.provider}</small>
                  </div>
                  <div className="provider-status">
                    <span>{STATUS_LABEL[provider.status]}</span>
                    {provider.detail && <small>{provider.detail}</small>}
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[12px] leading-relaxed text-white/42">
              <code>.env.local</code>에 <code>ANTHROPIC_API_KEY</code> 또는 <code>OPENAI_API_KEY</code>를 넣고
              서버를 다시 시작하세요.
            </p>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => void load(true)} disabled={checking} className="sheet-secondary flex-1">
                {checking ? "확인 중…" : "다시 확인"}
              </button>
              <button type="button" onClick={() => setOpen(false)} className="sheet-done flex-1">
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
