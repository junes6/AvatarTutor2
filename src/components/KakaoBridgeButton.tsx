"use client";

import { useEffect, useRef, useState } from "react";
import {
  isKakaoChannelConfigured,
  isKakaoSdkConfigured,
  loadKakaoSdk,
  openKakaoChannelNow,
  openKakaoChannelWeb,
  shareToKakao,
} from "@/lib/kakao";

interface KakaoBridgeButtonProps {
  tutorName: string;
  shareText: string;
  action?: "share" | "channel";
  compact?: boolean;
  className?: string;
}

export default function KakaoBridgeButton({ tutorName, shareText, action = "share", compact = false, className = "" }: KakaoBridgeButtonProps) {
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  const [manualText, setManualText] = useState("");
  const noticeTimer = useRef<number | null>(null);
  const manualTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const opensChannel = action === "channel" && isKakaoChannelConfigured();

  useEffect(() => {
    if (isKakaoSdkConfigured()) void loadKakaoSdk();
    return () => {
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    };
  }, []);

  const showNotice = (message: string, timeout = 3_800) => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    setNotice(message);
    noticeTimer.current = window.setTimeout(() => {
      setNotice("");
      noticeTimer.current = null;
    }, timeout);
  };

  const handleClick = async () => {
    if (working) return;
    setWorking(true);
    setNotice("");
    setManualText("");
    try {
      // A configured channel opens a new KakaoTalk conversation. It does not
      // transfer this app's private transcript or session state.
      if (opensChannel) {
        if (openKakaoChannelNow()) {
          showNotice("카카오톡 채널 대화를 열었어요");
          return;
        }
        void loadKakaoSdk();
        if (openKakaoChannelWeb()) {
          showNotice("카카오톡 채널 페이지를 열었어요");
          return;
        }
      }
      const result = await shareToKakao({
        title: `${tutorName}와 영어 대화`,
        text: shareText || `${tutorName}와 영어 연습을 이어가 보세요.`,
        onNativeShareOpen: () => showNotice("공유창에서 카카오톡을 선택해 주세요", 10_000),
      });
      if (result.method === "kakao") {
        showNotice("카카오톡 공유창을 열었어요");
      } else if (result.method === "native") {
        showNotice("공유를 완료했어요");
      } else if (result.method === "clipboard") {
        showNotice(
          result.includesLink
            ? "내용과 접속 링크를 복사했어요. 카카오톡에 붙여넣으세요"
            : "연습 내용을 복사했어요. 공개 접속 링크는 배포 주소 설정 후 함께 전송돼요",
          5_000,
        );
      } else {
        setManualText(result.content);
        showNotice("자동 복사가 막혔어요. 아래 내용을 직접 복사해 주세요", 7_000);
      }
    } catch (error) {
      // Closing the native share sheet is not a user-facing error.
      if (error instanceof DOMException && error.name === "AbortError") {
        showNotice("공유를 취소했어요", 2_200);
        return;
      }
      showNotice("공유를 열지 못했어요. 잠시 뒤 다시 시도해 주세요");
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleClick}
        disabled={working}
        className={`${compact ? "kakao-bridge-compact" : "kakao-bridge"} ${className}`}
        aria-label={opensChannel ? "카카오 채널에서 새 대화 시작" : "카카오톡으로 공유하기"}
        aria-describedby={notice ? "kakao-share-status" : undefined}
      >
        <span className="kakao-bubble" aria-hidden="true">TALK</span>
        {!compact && <span>{opensChannel ? "카카오 채널 열기" : "카카오톡으로 공유"}</span>}
      </button>
      {notice && <div id="kakao-share-status" className="kakao-notice" role="status" aria-live="polite">{notice}</div>}
      {manualText && (
        <div className="absolute right-0 top-[calc(100%+42px)] z-40 w-[min(320px,calc(100vw-40px))] rounded-2xl border border-white/10 bg-[#202025] p-3 text-left shadow-2xl" role="dialog" aria-label="공유 내용 직접 복사">
          <p className="mb-2 text-[11px] leading-relaxed text-white/65">아래 내용을 길게 눌러 복사한 뒤 카카오톡 채팅창에 붙여넣으세요.</p>
          <textarea
            ref={manualTextareaRef}
            readOnly
            value={manualText}
            onFocus={(event) => event.currentTarget.select()}
            className="h-28 w-full resize-none rounded-xl border border-white/10 bg-black/25 p-2.5 text-[11px] leading-relaxed text-white/80 outline-none focus:border-[#fee500]/60"
            aria-label="복사할 공유 내용"
          />
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => {
              manualTextareaRef.current?.focus();
              manualTextareaRef.current?.select();
              showNotice("내용을 선택했어요. 복사를 누른 뒤 카카오톡에 붙여넣으세요", 5_000);
            }} className="min-h-11 flex-1 rounded-xl bg-[#fee500] px-3 text-[11px] font-bold text-[#191919]">내용 선택</button>
            <button type="button" onClick={() => setManualText("")} className="min-h-11 rounded-xl bg-white/10 px-3 text-[11px] font-semibold text-white/70">닫기</button>
          </div>
        </div>
      )}
    </div>
  );
}
