"use client";

// 아바타 표시 레이어 (L0/L1/L2) — 환경변수로 전환, 상위 단계 실패 시 자동 폴백.
// L0: 프로필 + 말할 때 파형/입모양 애니메이션 (기본)
// L1: 아이들/토킹 루프 영상 (public/avatars/video/{id}-idle.mp4 / {id}-talk.mp4)
// L2: 실시간 아바타 API 어댑터 (Anam/Simli) — 키·SDK 연동 후 활성화, 실패 시 L1→L0

import { useEffect, useRef, useState } from "react";

interface TutorLite {
  id: string;
  name: string;
  profileImage: string;
  color: string;
}

interface Props {
  tutor: TutorLite;
  speaking: boolean;
  layer: string; // "0" | "1" | "2" | "auto"
  size?: number;
}

export default function AvatarView({ tutor, speaking, layer, size = 220 }: Props) {
  const [resolved, setResolved] = useState<"0" | "1">("0");
  const [videoOk, setVideoOk] = useState<boolean | null>(null);
  const [l2Failed, setL2Failed] = useState(false);

  // L2: 실시간 아바타 세션 시도 — 실패하면 L1/L0으로 자동 폴백
  useEffect(() => {
    if (layer !== "2" || l2Failed) return;
    let mounted = true;
    const controller = new AbortController();
    fetch("/api/avatar/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tutorId: tutor.id }),
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data: { ok: boolean; reason?: string }) => {
        if (!mounted) return;
        if (!data.ok) {
          console.info("[avatar] L2 사용 불가 → 하위 레이어 폴백:", data.reason);
          setL2Failed(true);
        } else {
          // 통합 지점: 제공자 SDK(@anam-ai/js-sdk 또는 simli-client)로
          // sessionToken을 사용해 WebRTC 스트림을 이 컨테이너에 연결한다.
          // SDK 미설치 상태에서는 안전하게 폴백한다.
          setL2Failed(true);
        }
      })
      .catch(() => mounted && setL2Failed(true));
    return () => {
      mounted = false;
      controller.abort();
    };
  }, [layer, l2Failed, tutor.id]);

  // L1 영상 존재 확인 (auto/1/2 → 영상 있으면 L1, 없으면 L0)
  useEffect(() => {
    let mounted = true;
    if (layer === "0") {
      const timer = window.setTimeout(() => mounted && setResolved("0"), 0);
      return () => {
        mounted = false;
        window.clearTimeout(timer);
      };
    }
    fetch(`/avatars/video/${tutor.id}-idle.mp4`, { method: "HEAD" })
      .then((r) => {
        if (!mounted) return;
        const ok = r.ok && (r.headers.get("content-type") ?? "").includes("video");
        setVideoOk(ok);
        setResolved(ok ? "1" : "0");
      })
      .catch(() => {
        if (mounted) {
          setVideoOk(false);
          setResolved("0");
        }
      });
    return () => {
      mounted = false;
    };
  }, [layer, tutor.id]);

  if (resolved === "1" && videoOk) {
    return <VideoAvatar tutor={tutor} speaking={speaking} size={size} />;
  }
  return <PhotoAvatar tutor={tutor} speaking={speaking} size={size} />;
}

/** L1 — 아이들/토킹 루프 영상 전환 */
function VideoAvatar({ tutor, speaking, size }: { tutor: TutorLite; speaking: boolean; size: number }) {
  const idleRef = useRef<HTMLVideoElement>(null);
  const talkRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    idleRef.current?.play().catch(() => {});
    talkRef.current?.play().catch(() => {});
  }, []);

  return (
    <div
      className={`avatar-view avatar-video ${speaking ? "is-speaking" : ""}`}
      style={{ width: size, height: size * 1.16, "--avatar-color": tutor.color } as React.CSSProperties}
      role="img"
      aria-label={`${tutor.name}${speaking ? "이 말하는 중" : ""}`}
    >
      <video ref={idleRef} src={`/avatars/video/${tutor.id}-idle.mp4`} muted loop playsInline
        className={`avatar-video-layer ${speaking ? "opacity-0" : "opacity-100"}`} />
      <video ref={talkRef} src={`/avatars/video/${tutor.id}-talk.mp4`} muted loop playsInline
        className={`avatar-video-layer ${speaking ? "opacity-100" : "opacity-0"}`} />
      <span className="avatar-status-ring" aria-hidden="true" />
    </div>
  );
}

/** L0 — 프로필 사진 + 발화 애니메이션 (완전 무료 기본 레이어) */
function PhotoAvatar({ tutor, speaking, size }: { tutor: TutorLite; speaking: boolean; size: number }) {
  const [bars, setBars] = useState<number[]>([0.3, 0.5, 0.4, 0.6, 0.3]);
  const rafRef = useRef(0);

  useEffect(() => {
    if (!speaking) return;
    let t = 0;
    const loop = () => {
      t += 0.25;
      setBars(
        Array.from({ length: 5 }, (_, i) => 0.25 + Math.abs(Math.sin(t + i * 1.3)) * 0.75 * (0.6 + Math.random() * 0.4)),
      );
      rafRef.current = window.setTimeout(loop, 90) as unknown as number;
    };
    loop();
    return () => clearTimeout(rafRef.current);
  }, [speaking]);

  const visibleBars = speaking ? bars : [0.15, 0.15, 0.15, 0.15, 0.15];

  return (
    <div className={`avatar-view avatar-photo ${speaking ? "is-speaking" : ""}`} style={{ "--avatar-color": tutor.color } as React.CSSProperties}>
      <div className="avatar-photo-frame" style={{ width: size, height: size }} role="img" aria-label={`${tutor.name}${speaking ? "이 말하는 중" : ""}`}>
        <span className="avatar-aura" aria-hidden="true" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={tutor.profileImage}
          alt=""
          className={`avatar-photo-image ${speaking ? "is-speaking" : "avatar-idle-bob"}`}
          draggable={false}
        />
        <span className="avatar-status-ring" aria-hidden="true" />
      </div>
      <div className="avatar-wave" aria-hidden="true">
        {visibleBars.map((b, i) => (
          <div
            key={i}
            style={{ height: `${Math.max(3, b * 17)}px`, opacity: speaking ? 1 : 0.3 }}
          />
        ))}
      </div>
    </div>
  );
}
