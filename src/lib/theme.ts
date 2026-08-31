// 테마 선택 — 라이트(기본) / 다크 / 시스템.
// 색값은 globals.css의 토큰에만 있고, 여기서는 <html data-theme>만 바꾼다.

export type ThemePreference = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "avatar-tutor-theme";
export const THEME_OPTIONS: { id: ThemePreference; label: string }[] = [
  { id: "light", label: "라이트" },
  { id: "dark", label: "다크" },
  { id: "system", label: "시스템" },
];

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function readTheme(): ThemePreference {
  if (typeof window === "undefined") return "light";
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : "light";
  } catch {
    // 프라이빗 모드 등에서 접근이 막혀도 기본값으로 동작해야 한다.
    return "light";
  }
}

export function applyTheme(preference: ThemePreference) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = preference;
}

export function saveTheme(preference: ThemePreference) {
  applyTheme(preference);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {}
}

/**
 * 첫 페인트 전에 실행돼 깜빡임을 막는 인라인 스크립트.
 * localStorage를 못 읽어도 기본값(라이트)으로 조용히 진행한다.
 */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");document.documentElement.dataset.theme=(t==="dark"||t==="system")?t:"light";}catch(e){document.documentElement.dataset.theme="light";}})();`;
