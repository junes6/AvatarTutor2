"use client";

// 설정 — 자막, 말 속도, 알림, 이름, 푸시

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { subscribePush } from "@/components/SWRegister";
import type { UserSettings } from "@/core/types";

export default function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [name, setName] = useState("");
  const [pushState, setPushState] = useState<"idle" | "ok" | "fail">("idle");

  useEffect(() => {
    fetch("/api/state")
      .then((r) => r.json())
      .then((data) => {
        setSettings(data.user.settings);
        setName(data.user.name);
      });
  }, []);

  const save = async (patch: Partial<UserSettings>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    await fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: patch }),
    });
  };

  const saveName = async () => {
    await fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  };

  if (!settings) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-white/20 border-t-emerald-400 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="px-5 py-6 pb-14">
      <header className="flex items-center gap-3 mb-6">
        <button onClick={() => router.push("/")} className="text-white/60 text-lg">
          ←
        </button>
        <h1 className="text-lg font-bold">설정</h1>
      </header>

      <Section title="이름">
        <div className="flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} className="flex-1 rounded-xl bg-white/10 px-4 py-3 text-sm outline-none focus:ring-2 ring-emerald-500" />
          <button onClick={saveName} className="rounded-xl bg-emerald-600 px-4 text-sm font-semibold">
            저장
          </button>
        </div>
      </Section>

      <Section title="자막 표시">
        <Segmented
          options={[
            { value: "always", label: "항상" },
            { value: "tap", label: "탭하면" },
            { value: "off", label: "끄기" },
          ]}
          value={settings.subtitles}
          onChange={(v) => save({ subtitles: v as UserSettings["subtitles"] })}
        />
      </Section>

      <Section title="튜터 말 속도">
        <Segmented
          options={[
            { value: "0.8", label: "0.8× 천천히" },
            { value: "1", label: "1.0× 보통" },
            { value: "1.2", label: "1.2× 빠르게" },
          ]}
          value={String(settings.speechRate)}
          onChange={(v) => save({ speechRate: Number(v) as UserSettings["speechRate"] })}
        />
      </Section>

      <Section title="알림">
        <Toggle label="알림 전체" checked={settings.notifications.enabled} onChange={(v) => save({ notifications: { ...settings.notifications, enabled: v } })} />
        <Toggle label="아침 인사" checked={settings.notifications.morning} onChange={(v) => save({ notifications: { ...settings.notifications, morning: v } })} />
        <Toggle label="복습 퀴즈" checked={settings.notifications.quiz} onChange={(v) => save({ notifications: { ...settings.notifications, quiz: v } })} />
        <Toggle label="근황 질문 · 안부" checked={settings.notifications.checkin} onChange={(v) => save({ notifications: { ...settings.notifications, checkin: v } })} />
        <button
          onClick={async () => setPushState((await subscribePush()) ? "ok" : "fail")}
          className="mt-3 w-full rounded-xl bg-white/10 py-3 text-sm font-semibold"
        >
          {pushState === "ok" ? "✅ 푸시 알림 켜짐" : pushState === "fail" ? "푸시 설정 실패 (VAPID 키 확인)" : "🔔 브라우저 푸시 알림 켜기"}
        </button>
        <p className="text-[11px] text-white/35 mt-2">홈 화면에 앱을 설치하면 알림을 더 안정적으로 받을 수 있어요.</p>
      </Section>

      <Section title="기타">
        <button onClick={() => router.push("/admin")} className="w-full rounded-xl bg-white/10 py-3 text-sm text-left px-4">
          📊 관리자 (사용량·원가)
        </button>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="text-sm font-bold text-white/70 mb-2">{title}</h2>
      <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-2.5">{children}</div>
    </section>
  );
}

function Segmented({ options, value, onChange }: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex rounded-xl bg-white/5 p-1 gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-lg py-2 text-xs font-semibold transition-colors ${value === o.value || (o.value === "1" && value === "1") ? (value === o.value ? "bg-emerald-600 text-white" : "text-white/50") : "text-white/50"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)} className="w-full flex items-center justify-between py-1">
      <span className="text-sm text-white/80">{label}</span>
      <span className={`w-11 h-6 rounded-full p-0.5 transition-colors ${checked ? "bg-emerald-500" : "bg-white/15"}`}>
        <span className={`block w-5 h-5 rounded-full bg-white transition-transform ${checked ? "translate-x-5" : ""}`} />
      </span>
    </button>
  );
}
