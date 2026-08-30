"use client";

// Kakao JavaScript SDK v2 bridge. The SDK is loaded only when a Kakao
// JavaScript key exists; otherwise callers can fall back to the Web Share API.

interface KakaoLinkTarget {
  mobileWebUrl: string;
  webUrl: string;
}

interface KakaoSdk {
  init: (javascriptKey: string) => void;
  isInitialized: () => boolean;
  Share: {
    sendDefault: (payload: {
      objectType: "text";
      text: string;
      link: KakaoLinkTarget;
    }) => void;
  };
  Channel: {
    chat: (payload: { channelPublicId: string }) => void;
  };
}

export type KakaoShareMethod = "kakao" | "native" | "clipboard" | "manual";

export interface KakaoShareResult {
  method: KakaoShareMethod;
  /** Always returned so the UI can expose a manual copy fallback. */
  content: string;
  /** False when the app only has a localhost URL that another device cannot open. */
  includesLink: boolean;
}

declare global {
  interface Window {
    Kakao?: KakaoSdk;
  }
}

const SDK_SRC = "https://t1.kakaocdn.net/kakao_js_sdk/2.8.2/kakao.min.js";
const SDK_INTEGRITY = "sha384-zt/G7/KfaRQ9dT/QIkS0ujMtzouJqzuSJcXVQu50x0rl/+mD1dc70AeOejVbMD9E";
const SDK_LOAD_TIMEOUT_MS = 4_000;
let sdkPromise: Promise<KakaoSdk | null> | null = null;

export const kakaoConfig = {
  javascriptKey: process.env.NEXT_PUBLIC_KAKAO_JAVASCRIPT_KEY ?? "",
  channelPublicId: process.env.NEXT_PUBLIC_KAKAO_CHANNEL_ID ?? "",
};

export function isKakaoChannelConfigured(): boolean {
  // A channel can always be opened through its public HTTPS page. The
  // JavaScript key only upgrades that action to the in-app SDK dialog.
  return Boolean(kakaoConfig.channelPublicId);
}

export function isKakaoSdkConfigured(): boolean {
  return Boolean(kakaoConfig.javascriptKey);
}

function readyKakaoSdk(): KakaoSdk | null {
  if (typeof window === "undefined" || !kakaoConfig.javascriptKey || !window.Kakao) return null;
  try {
    if (!window.Kakao.isInitialized()) window.Kakao.init(kakaoConfig.javascriptKey);
    return window.Kakao;
  } catch {
    return null;
  }
}

export function loadKakaoSdk(): Promise<KakaoSdk | null> {
  if (typeof window === "undefined" || !kakaoConfig.javascriptKey) return Promise.resolve(null);
  const ready = readyKakaoSdk();
  if (ready) return Promise.resolve(ready);
  if (sdkPromise) return sdkPromise;

  const pending = new Promise<KakaoSdk | null>((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SDK_SRC}"]`);
    const script = existing ?? document.createElement("script");
    let settled = false;
    let timeout = 0;

    const cleanup = () => {
      window.clearTimeout(timeout);
      script.removeEventListener("load", done);
      script.removeEventListener("error", failed);
    };
    const finish = (sdk: KakaoSdk | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(sdk);
    };
    const done = () => {
      script.dataset.kakaoSdkState = "loaded";
      try {
        if (!window.Kakao) return finish(null);
        if (!window.Kakao.isInitialized()) window.Kakao.init(kakaoConfig.javascriptKey);
        finish(window.Kakao);
      } catch {
        finish(null);
      }
    };
    const failed = () => {
      script.dataset.kakaoSdkState = "error";
      finish(null);
      script.remove();
    };

    script.addEventListener("load", done, { once: true });
    script.addEventListener("error", failed, { once: true });
    timeout = window.setTimeout(() => {
      script.dataset.kakaoSdkState = "timeout";
      finish(null);
      script.remove();
    }, SDK_LOAD_TIMEOUT_MS);
    if (!existing) {
      script.src = SDK_SRC;
      script.async = true;
      script.crossOrigin = "anonymous";
      script.integrity = SDK_INTEGRITY;
      script.referrerPolicy = "no-referrer";
      document.head.appendChild(script);
    } else if (window.Kakao || script.dataset.kakaoSdkState === "loaded" || script.dataset.kakaoSdkState === "error") {
      // A prior call may have observed the script after its load event. Resolve
      // on the next microtask instead of leaving the button pending forever.
      queueMicrotask(window.Kakao ? done : failed);
    }
  });
  sdkPromise = pending.then((sdk) => {
    if (!sdk) sdkPromise = null;
    return sdk;
  });
  return sdkPromise;
}

/** Must be called directly from the click stack so Kakao's popup keeps user activation. */
export function openKakaoChannelNow(): boolean {
  if (!isKakaoChannelConfigured() || !kakaoConfig.javascriptKey) return false;
  const kakao = readyKakaoSdk();
  if (!kakao) return false;
  try {
    kakao.Channel.chat({ channelPublicId: kakaoConfig.channelPublicId });
    return true;
  } catch {
    return false;
  }
}

export function kakaoChannelWebUrl(): string | null {
  const id = kakaoConfig.channelPublicId.trim();
  if (!id || !/^[_a-zA-Z0-9-]{2,80}$/.test(id)) return null;
  return `https://pf.kakao.com/${encodeURIComponent(id)}/chat`;
}

/** Opens the public channel page synchronously from a click when the SDK is unavailable. */
export function openKakaoChannelWeb(): boolean {
  if (typeof window === "undefined") return false;
  const url = kakaoChannelWebUrl();
  if (!url) return false;
  try {
    const opened = window.open(url, "_blank");
    if (!opened) return false;
    try { opened.opener = null; } catch {}
    return true;
  } catch {
    return false;
  }
}

function shareContent(input: { title: string; text: string }, url?: string): string {
  return `${input.title}\n\n${input.text}${url ? `\n${url}` : ""}`.trim();
}

function portableShareUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function shouldUseNativeShare(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") return false;
  const mobileUserAgent = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent ?? "");
  const coarsePointer = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  const installedApp = typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches;
  // Some desktop shells expose navigator.share but leave its Promise pending
  // without a visible, usable share target. Copying is deterministic there.
  return mobileUserAgent || coarsePointer || installedApp;
}

async function copyForSharing(content: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(content);
      return true;
    } catch {
      // Clipboard API is commonly denied on LAN HTTP. Continue to the legacy
      // selection-based copy path before asking the user to copy manually.
    }
  }
  if (typeof document === "undefined" || typeof document.execCommand !== "function") return false;
  const textarea = document.createElement("textarea");
  textarea.value = content;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.inset = "-9999px auto auto -9999px";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

export async function shareToKakao(input: {
  title: string;
  text: string;
  url?: string;
  onNativeShareOpen?: () => void;
}): Promise<KakaoShareResult> {
  if (typeof window === "undefined") throw new Error("sharing is only available in a browser");
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const url = portableShareUrl(input.url)
    ?? portableShareUrl(configuredUrl)
    ?? portableShareUrl(window.location.href);
  const content = shareContent(input, url);
  const kakao = readyKakaoSdk();
  if (kakao && url) {
    try {
      kakao.Share.sendDefault({
        objectType: "text",
        text: `${input.title}\n\n${input.text}`.slice(0, 1000),
        link: { mobileWebUrl: url, webUrl: url },
      });
      return { method: "kakao", content, includesLink: true };
    } catch {
      // Fall through to the browser-native share sheet.
    }
  }

  // Warm a late SDK load for the next click, but never await it here: awaiting
  // before opening a share surface would discard the browser's user activation.
  void loadKakaoSdk();

  const nativeShare = typeof navigator !== "undefined" ? navigator.share : undefined;
  if (typeof nativeShare === "function" && shouldUseNativeShare()) {
    try {
      input.onNativeShareOpen?.();
      await nativeShare.call(navigator, {
        title: input.title,
        text: `${input.title}\n\n${input.text}`,
        ...(url ? { url } : {}),
      });
      return { method: "native", content, includesLink: Boolean(url) };
    } catch (error) {
      // Cancelling is intentional. Permission/implementation failures should
      // still fall through to clipboard instead of leaving a dead button.
      if (error instanceof DOMException && error.name === "AbortError") throw error;
    }
  }

  if (await copyForSharing(content)) return { method: "clipboard", content, includesLink: Boolean(url) };
  return { method: "manual", content, includesLink: Boolean(url) };
}
