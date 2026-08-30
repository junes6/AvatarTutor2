import type { Metadata, Viewport } from "next";
import "./globals.css";
import SWRegister from "@/components/SWRegister";
import DemoBanner from "@/components/DemoBanner";
import ToastHost from "@/components/Toast";

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
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "아바타튜터" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#060a13",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="antialiased">
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
