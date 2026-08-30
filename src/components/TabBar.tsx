"use client";

// 하단 탭 — 화면을 채팅 목록과 마이페이지 둘로 좁혔다. 채팅방/통화는 전체화면이다.

import { usePathname, useRouter } from "next/navigation";

interface TabBarProps {
  unread?: number;
}

export default function TabBar({ unread = 0 }: TabBarProps) {
  const router = useRouter();
  const pathname = usePathname();

  const tabs = [
    { href: "/", label: "채팅", icon: <ChatIcon />, badge: unread },
    { href: "/me", label: "마이", icon: <PersonIcon />, badge: 0 },
  ];

  return (
    <nav className="tab-bar" aria-label="주요 화면">
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <button
            key={tab.href}
            type="button"
            className={`tab-item ${active ? "is-active" : ""}`}
            aria-current={active ? "page" : undefined}
            onClick={() => router.push(tab.href)}
          >
            <span className="tab-icon">
              {tab.icon}
              {tab.badge > 0 && <i className="tab-badge">{tab.badge > 99 ? "99+" : tab.badge}</i>}
            </span>
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8.7 8.7 0 0 1-2.7-.5L5 20l1.3-3.8A7.2 7.2 0 0 1 4 11c0-4.1 3.6-7 8-7s8 3.2 8 7.5Z" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20c.4-4.3 3.4-6.5 7.5-6.5s7.1 2.2 7.5 6.5" />
    </svg>
  );
}
