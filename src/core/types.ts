// 도메인 공용 타입 — 코어 파이프라인(서버/CLI)과 UI가 함께 사용한다.

export type Mode = "freetalk" | "learning" | "chat";

// ── 튜터 페르소나 ──
export interface TutorPersona {
  id: string;
  name: string;
  koName: string;
  age: number;
  job: string;
  nationality: string;
  emoji: string;
  color: string; // 테마 컬러 (hex)
  personality: string; // 성격 서술 (프롬프트 주입용, 한국어)
  speakingStyle: string; // 말투 서술
  interests: string[];
  bio: string; // 친구 목록에 보이는 한 줄 소개
  profileImage: string; // /avatars/{id}.svg
  voice: {
    openai: string; // OpenAI TTS voice id
    elevenlabs?: string; // ElevenLabs voice id (선택)
  };
  firstMessage: { en: string; ko: string }; // 온보딩 첫 메시지
  toneByIntimacy: Record<string, string>; // "1".."5" → 말투 지침
  topicsByIntimacy: Record<string, string[]>; // 레벨별 해금 대화 주제
}

// ── 커리큘럼 ──
export interface Expression {
  id: string;
  en: string;
  ko: string;
  example: string;
  exampleKo: string;
}

export interface Unit {
  id: string;
  level: number;
  order: number;
  title: string; // 영어 제목
  titleKo: string;
  topic: string; // 프롬프트용 주제 서술
  expressions: Expression[];
  situation: {
    setting: string; // 미니 롤플레이 배경
    tutorRole: string;
    learnerRole: string;
    goalKo: string; // 클리어 조건 안내
  };
}

export interface Scenario {
  id: string;
  title: string;
  titleKo: string;
  image: string; // /scenes/{id}.svg
  ambience?: string; // /scenes/{id}-ambience.wav (없으면 무음)
  tutorRole: string;
  learnerRole: string;
  descriptionKo: string;
}

// ── 대화 파이프라인 ──
export interface CorrectionCard {
  original: string;
  better: string;
  ko: string; // better의 해석
  reason: string; // 왜 더 자연스러운지 (한국어)
  type: "grammar" | "article" | "tense" | "preposition" | "konglish" | "awkward" | "word-choice";
}

export interface SuggestionCard {
  en: string;
  ko: string;
}

// LLM이 반환하는 턴 결과 (JSON 계약)
export interface TutorTurnOutput {
  reply: string;
  reply_ko: string;
  correction: CorrectionCard | null;
  suggestion: SuggestionCard | null;
  new_expression: string | null; // 러닝모드 intro에서 소개한 표현 id
  used_expressions: string[]; // 학습자가 올바르게 쓴 목표 표현 id
  stage_signal: "stay" | "advance";
  end_call: boolean;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface TurnResult extends TutorTurnOutput {
  usage: TokenUsage;
  judgment?: Judgment; // 따라 말하기 턴일 때
}

// 따라 말하기/발음 판정
export interface Judgment {
  target: string;
  said: string;
  score: number; // 0~100
  pass: boolean;
  method: "azure" | "similarity";
  wordScores?: { word: string; score: number }[];
}

// ── 세션 기록 ──
export interface TurnLog {
  id: string;
  role: "user" | "tutor";
  text: string;
  ko?: string;
  ts: number;
  correction?: CorrectionCard | null;
  suggestion?: SuggestionCard | null;
  judgment?: Judgment;
  usage?: TokenUsage;
}

export type LearningStage = "review" | "intro" | "practice" | "roleplay" | "done";

export interface StageState {
  stage: LearningStage;
  reviewItems: { expressionId: string; en: string; ko: string; result?: "pass" | "retry" }[];
  reviewIndex: number;
  introIndex: number; // 소개 완료한 표현 수
  practicedIds: string[]; // 유도 연습에서 따라 말하기 통과한 표현
  roleplayUsedIds: string[]; // 롤플레이에서 사용한 목표 표현
  turnsInStage: number;
  combo: number;
}

export interface SessionRecord {
  id: string;
  tutorId: string;
  mode: Mode;
  scenarioId?: string;
  unitId?: string;
  startedAt: number;
  endedAt?: number;
  turns: TurnLog[];
  corrections: CorrectionCard[];
  judgments: Judgment[];
  xpEarned: number;
  stageState?: StageState;
  pronunciationScores: number[]; // 추이 그래프용
}

// ── 채팅 ──
export interface ChatMessage {
  id: string;
  role: "user" | "tutor";
  text: string;
  ko?: string;
  correction?: CorrectionCard | null;
  ts: number;
  read: boolean;
  proactiveType?: ProactiveType; // 튜터가 먼저 보낸 메시지의 종류
}

export type ProactiveType = "morning" | "quiz" | "checkin" | "missyou";

// ── 사용자 상태 ──
export interface UserSettings {
  subtitles: "always" | "tap" | "off";
  speechRate: 0.8 | 1.0 | 1.2;
  notifications: { enabled: boolean; morning: boolean; quiz: boolean; checkin: boolean };
}

export interface UserState {
  onboarded: boolean;
  name: string;
  level: number; // 1~5
  xp: number;
  streak: { count: number; lastActive: string }; // lastActive: YYYY-MM-DD
  settings: UserSettings;
  completedUnits: string[];
  firstTutorId?: string;
  dailyGoal: { date: string; reviewsDone: number; unitDone: boolean; callSeconds: number };
  levelTestNote?: string;
}

// ── 튜터별 장기기억/친밀도 ──
export interface MemoryFact {
  text: string; // "지난주에 부산 여행을 다녀옴"
  kind: "recent" | "interest" | "promise" | "mistake" | "profile";
  date: string; // YYYY-MM-DD
}

export interface TutorState {
  intimacyXp: number;
  memory: MemoryFact[];
  lastInteraction: number; // epoch ms
}

// ── 간격 반복 (SRS) ──
export interface SrsItem {
  id: string;
  expressionId: string;
  unitId: string;
  due: string; // YYYY-MM-DD
  stage: number; // 0: 당일, 1: 3일, 2: 7일, 3: 졸업
  lapses: number;
}

// ── 사용량 ──
export interface UsageEntry {
  ts: number;
  kind: "llm" | "stt" | "tts";
  model: string;
  feature: string; // turn | chat | proactive | memory | hint | leveltest ...
  inputTokens?: number;
  outputTokens?: number;
  seconds?: number;
  chars?: number;
}
