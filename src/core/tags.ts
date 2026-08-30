// 온보딩 · 페르소나 · 궁합 엔진이 공유하는 정규화 태그.
// 서버 전용 API(fs 등)를 쓰지 않으므로 클라이언트 컴포넌트에서도 그대로 import한다.

import type { AgeBand, LearningGoal, Occupation, Temperament } from "./types";

export const INTEREST_TAGS = [
  { id: "music", label: "음악", emoji: "🎧" },
  { id: "movies", label: "영화·드라마", emoji: "🎬" },
  { id: "travel", label: "여행", emoji: "✈️" },
  { id: "food", label: "맛집·요리", emoji: "🍜" },
  { id: "sports", label: "스포츠", emoji: "⚽" },
  { id: "games", label: "게임", emoji: "🎮" },
  { id: "art", label: "디자인·예술", emoji: "🎨" },
  { id: "tech", label: "IT·테크", emoji: "💻" },
  { id: "pets", label: "반려동물", emoji: "🐾" },
  { id: "fashion", label: "패션·쇼핑", emoji: "👕" },
  { id: "books", label: "책·글쓰기", emoji: "📚" },
  { id: "fitness", label: "운동·헬스", emoji: "🏃" },
  { id: "coffee", label: "커피·카페", emoji: "☕" },
  { id: "photo", label: "사진", emoji: "📷" },
  { id: "outdoors", label: "자연·아웃도어", emoji: "🏔️" },
] as const;

export const INTEREST_IDS: string[] = INTEREST_TAGS.map((tag) => tag.id);

export function interestLabel(id: string): string {
  return INTEREST_TAGS.find((tag) => tag.id === id)?.label ?? id;
}

export const AGE_BANDS: { id: AgeBand; label: string }[] = [
  { id: "10s", label: "10대" },
  { id: "20s", label: "20대" },
  { id: "30s", label: "30대" },
  { id: "40s", label: "40대 이상" },
];

export const OCCUPATIONS: { id: Occupation; label: string }[] = [
  { id: "student", label: "학생" },
  { id: "office", label: "직장인" },
  { id: "freelance", label: "프리랜서·자영업" },
  { id: "other", label: "그 외" },
];

export const GOALS: { id: LearningGoal; label: string; hint: string }[] = [
  { id: "travel", label: "여행", hint: "공항·호텔·주문 같은 실전 상황" },
  { id: "work", label: "업무", hint: "회의·이메일·면접 영어" },
  { id: "exam", label: "시험", hint: "말하기 시험과 정확한 문장" },
  { id: "hobby", label: "취미", hint: "좋아하는 얘기를 영어로" },
];

export const STYLES: { id: Temperament; label: string; hint: string }[] = [
  { id: "calm", label: "차분한", hint: "천천히, 기다려 주는 친구" },
  { id: "lively", label: "활발한", hint: "텐션 높고 리액션이 큰 친구" },
];

const AGE_ORDER: AgeBand[] = ["10s", "20s", "30s", "40s"];

/** 연령대 거리 (0 = 동일, 1 = 인접) */
export function ageDistance(a: AgeBand, b: AgeBand): number {
  return Math.abs(AGE_ORDER.indexOf(a) - AGE_ORDER.indexOf(b));
}

export function isInterestTag(value: unknown): value is string {
  return typeof value === "string" && INTEREST_IDS.includes(value);
}

export function isAgeBand(value: unknown): value is AgeBand {
  return typeof value === "string" && AGE_ORDER.includes(value as AgeBand);
}

export function isOccupation(value: unknown): value is Occupation {
  return OCCUPATIONS.some((item) => item.id === value);
}

export function isGoal(value: unknown): value is LearningGoal {
  return GOALS.some((item) => item.id === value);
}

export function isTemperament(value: unknown): value is Temperament {
  return value === "calm" || value === "lively";
}
