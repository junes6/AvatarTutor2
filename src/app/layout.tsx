import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import SWRegister from "@/components/SWRegister";
import DemoBanner from "@/components/DemoBanner";
import ToastHost from "@/components/Toast";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme";

export const metadata: Metadata = {
  title: "아바타튜터 — 카톡하는 외국인 친구",
  description: "외국인 친구와 카톡하듯 대화하며 배우는 영어. 통화는 가끔.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "아바타튜터" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  // 토큰의 --bg 와 같은 값. 상태바 색이 앱 배경과 이어지게 한다.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f8" },
    { media: "(prefers-color-scheme: dark)", color: "#17171c" },
  ],
  colorScheme: "light dark",
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" data-theme="light" suppressHydrationWarning>
      <body className="antialiased">
        {/* 하이드레이션 전에 저장된 테마를 적용해 깜빡임을 막는다. */}
        <Script id="theme-bootstrap" strategy="beforeInteractive">
          {THEME_BOOTSTRAP_SCRIPT}
        </Script>
        <div className="app-shell">
          <DemoBanner />
          {children}
        </div>
        <ToastHost />
        <SWRegister />
      </body>
    </html>
  );
}
