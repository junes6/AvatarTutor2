"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { subscribePush } from "@/components/SWRegister";
import type { UserSettings } from "@/core/types";
import { readTheme, saveTheme, THEME_OPTIONS, type ThemePreference } from "@/lib/theme";

type SaveStatus = "idle" | "saving" | "saved" | "error";
type PushState = "idle" | "working" | "ok" | "fail";

interface SettingsPayload {
  user: { settings: UserSettings; name: string };
}

async function requestSettings(): Promise<SettingsPayload> {
  const response = await fetch("/api/state");
  if (!response.ok) throw new Error("state load failed");
  return response.json();
}

export default function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const settingsRef = useRef<UserSettings | null>(null);
  const [name, setName] = useState("");
  const [savedName, setSavedName] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [pushState, setPushState] = useState<PushState>("idle");
  const [loadError, setLoadError] = useState(false);
  const [theme, setTheme] = useState<ThemePreference>("light");
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setTheme(readTheme()));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const applyPayload = useCallback((data: SettingsPayload) => {
    settingsRef.current = data.user.settings;
    setSettings(data.user.settings);
    setName(data.user.name);
    setSavedName(data.user.name);
  }, []);

  useEffect(() => {
    let active = true;
    requestSettings()
      .then((data) => {
        if (active) applyPayload(data);
      })
      .catch(() => {
        if (active) setLoadError(true);
      });
    return () => { active = false; };
  }, [applyPayload]);
  useEffect(() => () => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
  }, []);

  const showStatus = useCallback((next: SaveStatus) => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    setSaveStatus(next);
    if (next === "saved" || next === "error") {
      statusTimerRef.current = setTimeout(() => setSaveStatus("idle"), 2200);
    }
  }, []);

  const save = async (patch: Partial<UserSettings>) => {
    const previous = settingsRef.current;
    if (!previous) return;
    const next = { ...previous, ...patch };
    settingsRef.current = next;
    setSettings(next);
    showStatus("saving");
    try {
      const response = await fetch("/api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: patch }),
      });
      if (!response.ok) throw new Error("settings save failed");
      showStatus("saved");
    } catch {
      if (settingsRef.current === next) {
        settingsRef.current = previous;
        setSettings(previous);
      }
      showStatus("error");
    }
  };

  const saveName = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === savedName || saveStatus === "saving") return;
    showStatus("saving");
    try {
      const response = await fetch("/api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!response.ok) throw new Error("name save failed");
      setName(trimmed);
      setSavedName(trimmed);
      showStatus("saved");
    } catch {
      showStatus("error");
    }
  };

  const enablePush = async () => {
    if (pushState === "working") return;
    setPushState("working");
    setPushState((await subscribePush()) ? "ok" : "fail");
  };

  const retryLoad = async () => {
    setLoadError(false);
    try {
      applyPayload(await requestSettings());
    } catch {
      setLoadError(true);
    }
  };

  if (loadError) {
    return (
      <main className="grid min-h-dvh place-items-center bg-bg px-6 text-ink">
        <div className="w-full max-w-xs text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-danger-soft text-danger"><WarningIcon /></div>
          <h1 className="mt-4 text-[18px] font-semibold">설정을 불러오지 못했어요</h1>
          <p className="mt-2 text-[13px] text-ink-secondary">연결을 확인하고 다시 시도해 주세요.</p>
          <button type="button" onClick={retryLoad} className="apple-primary-button mt-5 min-h-12 w-full rounded-2xl bg-yellow text-[14px] font-semibold">다시 시도</button>
        </div>
      </main>
    );
  }

  if (!settings) return <PageLoading label="설정 불러오는 중" />;

  return (
    <main className="min-h-dvh bg-bg text-ink">
      <div className="mx-auto w-full max-w-[430px] px-5 pb-[max(32px,env(safe-area-inset-bottom))] pt-[max(14px,env(safe-area-inset-top))]">
        <header className="flex min-h-12 items-center justify-between gap-3">
          <button type="button" onClick={() => router.push("/")} className="grid h-11 w-11 place-items-center rounded-full bg-fill text-ink-secondary transition active:scale-95 active:bg-fill-strong" aria-label="홈으로 돌아가기">
            <BackIcon />
          </button>
          <h1 className="text-[17px] font-semibold tracking-[-0.02em]">설정</h1>
          <SaveIndicator status={saveStatus} />
        </header>

        <div className="mt-7 space-y-7">
          <Section title="프로필">
            <div className="flex items-center gap-3 p-3.5">
              <label htmlFor="settings-name" className="sr-only">이름 또는 닉네임</label>
              <input
                id="settings-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void saveName();
                  }
                }}
                maxLength={24}
                autoComplete="nickname"
                enterKeyHint="done"
                className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-fill px-3.5 text-[16px] outline-none transition focus:border-yellow"
              />
              <button
                type="button"
                onClick={saveName}
                disabled={!name.trim() || name.trim() === savedName || saveStatus === "saving"}
                className="min-h-11 rounded-xl bg-yellow px-4 text-[13px] font-semibold transition active:scale-95 disabled:bg-fill disabled:text-ink-tertiary"
              >
                저장
              </button>
            </div>
          </Section>

          <Section title="화면">
            <PreferenceRow title="테마" description="기본은 라이트예요. 통화 화면은 항상 어둡게 유지됩니다">
              <Segmented
                label="화면 테마"
                options={THEME_OPTIONS.map((option) => ({ value: option.id, label: option.label }))}
                value={theme}
                onChange={(value) => {
                  const next = value as ThemePreference;
                  setTheme(next);
                  saveTheme(next);
                }}
              />
            </PreferenceRow>
          </Section>

          <Section title="대화">
            <PreferenceRow title="자막" description="통화 중 번역을 보여주는 방식">
              <Segmented
                label="자막 표시 방식"
                options={[
                  { value: "always", label: "항상" },
                  { value: "tap", label: "탭하면" },
                  { value: "off", label: "끄기" },
                ]}
                value={settings.subtitles}
                onChange={(value) => save({ subtitles: value as UserSettings["subtitles"] })}
              />
            </PreferenceRow>
            <Divider />
            <PreferenceRow title="말하기 속도" description="실력에 맞춘 기본 속도를 미세 조절해요">
              <Segmented
                label="튜터 말하기 속도"
                options={[
                  { value: "0.8", label: "느리게" },
                  { value: "1", label: "보통" },
                  { value: "1.2", label: "빠르게" },
                ]}
                value={String(settings.speechRate)}
                onChange={(value) => save({ speechRate: Number(value) as UserSettings["speechRate"] })}
              />
            </PreferenceRow>
            <Divider />
            <div className="px-4">
              <Toggle
                label="한국어 코칭 카드"
                description="한국어로 쓰면 영어 표현을 말풍선 아래에 붙여줘요"
                checked={settings.coachingCards}
                onChange={(value) => save({ coachingCards: value })}
              />
            </div>
          </Section>

          <Section title="알림">
            <div className="px-4">
              <Toggle label="전체 알림" description="친구의 메시지와 학습 알림" checked={settings.notifications.enabled} onChange={(value) => save({ notifications: { ...settings.notifications, enabled: value } })} />
              <Divider />
              <Toggle label="아침 인사" checked={settings.notifications.morning} onChange={(value) => save({ notifications: { ...settings.notifications, morning: value } })} />
              <Divider />
              <Toggle label="복습 퀴즈" checked={settings.notifications.quiz} onChange={(value) => save({ notifications: { ...settings.notifications, quiz: value } })} />
              <Divider />
              <Toggle label="안부 메시지" checked={settings.notifications.checkin} onChange={(value) => save({ notifications: { ...settings.notifications, checkin: value } })} />
              <Divider />
              <Toggle label="근황 사진" description="친구의 여행·일상 사진과 질문" checked={settings.notifications.life} onChange={(value) => save({ notifications: { ...settings.notifications, life: value } })} />
            </div>
            <Divider />
            <PreferenceRow title="하루 최대 발신" description="친구가 먼저 보내는 메시지 수">
              <Segmented
                label="하루 최대 발신 횟수"
                options={[
                  { value: "0", label: "끄기" },
                  { value: "2", label: "2회" },
                  { value: "3", label: "3회" },
                  { value: "5", label: "5회" },
                ]}
                value={String(settings.dailyProactiveLimit)}
                onChange={(value) => save({ dailyProactiveLimit: Number(value) })}
              />
            </PreferenceRow>
          </Section>

          <section aria-labelledby="push-title">
            <div className="rounded-[22px] border border-line bg-fill p-4">
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-yellow-soft text-accent-text"><BellIcon /></div>
                <div className="min-w-0 flex-1">
                  <h2 id="push-title" className="text-[14px] font-semibold">브라우저 알림</h2>
                  <p className="mt-1 text-[11px] leading-relaxed text-ink-secondary">기기에서 권한을 허용하면 앱을 닫아도 소식을 받을 수 있어요.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={enablePush}
                disabled={pushState === "working" || pushState === "ok"}
                className={`mt-4 flex min-h-11 w-full items-center justify-center rounded-xl text-[13px] font-semibold transition active:scale-[0.98] disabled:opacity-70 ${pushState === "ok" ? "bg-success-soft text-success" : "bg-fill text-ink"}`}
              >
                {pushState === "working" ? <><span className="mini-spinner mr-2" aria-hidden="true" />연결 중</> : pushState === "ok" ? <><CheckIcon />알림 켜짐</> : "알림 권한 허용"}
              </button>
              <p className={`mt-2 min-h-4 text-center text-[11px] ${pushState === "fail" ? "text-danger" : "text-ink-secondary"}`} role="status">
                {pushState === "fail" ? "권한을 확인한 뒤 다시 시도해 주세요." : ""}
              </p>
            </div>
          </section>

          <Section title="앱 정보">
            <button type="button" onClick={() => router.push("/admin")} className="flex min-h-13 w-full items-center gap-3 px-4 text-left transition active:bg-fill">
              <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-fill text-ink-secondary"><ChartIcon /></span>
              <span className="flex-1 text-[14px] font-medium">사용량 및 원가</span>
              <ChevronIcon />
            </button>
          </Section>
        </div>
      </div>
    </main>
  );
}

function PageLoading({ label }: { label: string }) {
  return <div className="grid min-h-dvh place-items-center bg-bg"><div className="apple-loader" role="status" aria-label={label} /></div>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-secondary">{title}</h2>
      <div className="overflow-hidden rounded-[18px] border border-line bg-surface shadow-[var(--shadow)]">{children}</div>
    </section>
  );
}

function PreferenceRow({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="p-4">
      <div>
        <div className="text-[14px] font-medium">{title}</div>
        <div className="mt-0.5 text-[11px] text-ink-secondary">{description}</div>
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Segmented({ options, value, onChange, label }: { options: { value: string; label: string }[]; value: string; onChange: (value: string) => void; label: string }) {
  return (
    <div className="apple-segment grid grid-cols-3 rounded-[11px] bg-fill p-1" role="radiogroup" aria-label={label}>
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={`min-h-11 rounded-[10px] px-1 text-[12px] font-semibold transition ${selected ? "is-selected bg-surface text-ink shadow-[var(--shadow)]" : "text-ink-secondary"}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function Toggle({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex min-h-13 w-full items-center justify-between gap-4 py-2.5 text-left">
      <span className="min-w-0">
        <span className="block text-[14px] font-medium text-ink">{label}</span>
        {description && <span className="mt-0.5 block text-[11px] text-ink-secondary">{description}</span>}
      </span>
      <span className={`relative h-[31px] w-[51px] shrink-0 rounded-full p-0.5 transition-colors ${checked ? "bg-yellow" : "bg-fill-strong"}`} aria-hidden="true">
        <span className={`block h-[27px] w-[27px] rounded-full bg-surface shadow-[var(--shadow)] transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`} />
      </span>
    </button>
  );
}

function Divider() {
  return <div className="ml-4 h-px bg-line" aria-hidden="true" />;
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  const label = status === "saving" ? "저장 중" : status === "saved" ? "저장됨" : status === "error" ? "저장 실패" : "";
  return (
    <div className={`flex h-10 min-w-10 items-center justify-end gap-1.5 text-[11px] font-medium ${status === "error" ? "text-danger" : status === "saved" ? "text-success" : "text-ink-secondary"}`} role="status" aria-live="polite">
      {status === "saving" && <span className="mini-spinner" aria-hidden="true" />}
      {status === "saved" && <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />}
      {label}
    </div>
  );
}

function BackIcon() {
  return <svg className="h-5 w-5 fill-none stroke-current stroke-2" viewBox="0 0 20 20" aria-hidden="true"><path d="m12.5 4.5-5 5.5 5 5.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function ChevronIcon() {
  return <svg className="h-5 w-5 fill-none stroke-white/24 stroke-2" viewBox="0 0 20 20" aria-hidden="true"><path d="m7.5 4.5 5 5.5-5 5.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function BellIcon() {
  return <svg className="h-5 w-5 fill-none stroke-current stroke-[1.8]" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function CheckIcon() {
  return <svg className="mr-1.5 h-4 w-4 fill-none stroke-current stroke-2" viewBox="0 0 20 20" aria-hidden="true"><path d="m5 10.3 3.1 3.1L15.3 6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function ChartIcon() {
  return <svg className="h-4 w-4 fill-none stroke-current stroke-[1.8]" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 16V9m6 7V4m6 12v-5" strokeLinecap="round" /></svg>;
}

function WarningIcon() {
  return <svg className="h-6 w-6 fill-none stroke-current stroke-2" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 3 20h18L12 4Z" strokeLinejoin="round" /><path d="M12 9v5m0 3v.1" strokeLinecap="round" /></svg>;
}
