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
  /** 레벨대별 짧은 첫 인사 ({name} 자리표시자 사용) */
  greetings?: Record<"beginner" | "intermediate" | "advanced", { en: string; ko: string }>;
  toneByIntimacy: Record<string, string>; // "1".."5" → 말투 지침
  topicsByIntimacy: Record<string, string[]>; // 레벨별 해금 대화 주제
  tags: PersonaTags; // 궁합 계산용 정규화 태그
  rhythm: PersonaRhythm; // 생활 리듬 (타임존 · 활동 시간대 · 응답 템포)
  life: PersonaLife; // 라이프 스케줄러가 일정을 만들 때 쓰는 소재
}

export type AgeBand = "10s" | "20s" | "30s" | "40s";
export type Temperament = "calm" | "lively";
export type Tempo = "slow" | "medium" | "fast";
export type LearningGoal = "travel" | "work" | "exam" | "hobby";
export type Occupation = "student" | "office" | "freelance" | "other";

export interface PersonaTags {
  ageBand: AgeBand;
  country: string; // US | UK | AU | CA | NZ
  occupation: Occupation;
  temperament: Temperament;
  tempo: Tempo;
  interests: string[]; // INTEREST_TAGS의 부분집합
  goals: LearningGoal[];
}

export interface PersonaRhythm {
  timezone: string; // IANA 타임존
  wakeHour: number; // 현지 기상 시각 (0~23)
  sleepHour: number; // 현지 취침 시각 (0~23, wakeHour보다 작으면 자정을 넘김)
  replySpeed: number; // 지연 배수 — 작을수록 답이 빠르다
}

export interface PersonaLife {
  homeCity: string;
  themes: string[];
  travelStyle: string;
  photoKeywords: { daily: string[]; food: string[]; place: string[] };
  /** 여행 일정이 생길 수 있는 도시 — 시차까지 함께 바뀐다 */
  travelDestinations: { city: string; timezone: string; keyword: string }[];
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
  goalKo: string; // 학습자가 상황극에서 달성할 실용 목표
  conversationFlow: string[]; // 한 번에 하나씩 진행할 자연스러운 장면 순서
  openingLine: string; // 역할에 맞는 첫 영어 대사
  keyExpressions: { en: string; ko: string }[]; // 브리핑 카드에 보여줄 쓸만한 표현 3개
  locked?: boolean; // 항상 false — 8종 모두 잠금 해제 상태로 둔다
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
  /** Stable id supplied by the client so interrupted duplicate phrases stay distinct. */
  clientTurnId?: string;
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

export interface PendingSessionTurn {
  text: string;
  inputLanguage: "en-US" | "ko-KR";
  clientTurnId?: string;
  repeatTarget?: string;
  savedAt: number;
}

export interface SessionRecord {
  id: string;
  tutorId: string;
  mode: Mode;
  scenarioId?: string;
  unitId?: string;
  startedAt: number;
  endedAt?: number;
  /** Last persisted learner/tutor activity or lifecycle change. */
  lastActiveAt?: number;
  /** Set while an unfinished practice is parked for later continuation. */
  pausedAt?: number;
  /** Active call time already persisted by the client, excluding time away. */
  elapsedSeconds?: number;
  /** Number of times this exact practice was restored. */
  resumeCount?: number;
  /** Monotonic client/server lifecycle token; stale pause beacons are ignored. */
  lifecycleVersion?: number;
  /** A learner utterance captured before an interrupted LLM turn completed. */
  pendingTurn?: PendingSessionTurn;
  turns: TurnLog[];
  corrections: CorrectionCard[];
  judgments: Judgment[];
  xpEarned: number;
  stageState?: StageState;
  pronunciationScores: number[]; // 추이 그래프용
}

// ── 채팅 ──

/** 한국어로 쓴 학습자에게 붙는 "영어로는 이렇게 말해요" 카드. */
export interface CoachingCard {
  /** 학습자가 쓴 원문 (한국어 또는 혼용) */
  source: string;
  /** 가장 자연스러운 한 문장 */
  primary: { en: string; ko: string };
  /** 상황·친밀도에 따른 두 가지 변형 */
  variants: { style: "casual" | "polite"; en: string; ko: string }[];
  /** 한 줄 팁 (한국어) */
  tip?: string;
}

export type PhotoSource = "unsplash" | "pexels" | "local" | "learner";

export interface ChatPhoto {
  url: string;
  alt: string;
  source: PhotoSource;
  /** 무료 API 라이선스 표기 의무를 지키기 위한 출처 */
  credit?: { name: string; link: string };
  /** 사진을 소재로 즉석 롤플레이를 열 때 쓰는 시나리오 id */
  roleplayScenarioId?: string;
}

export interface VoiceNote {
  durationSec: number;
  /** 파형 미리보기용 0~1 진폭 샘플 */
  peaks: number[];
  script: string;
  scriptKo?: string;
}

export interface CallSummary {
  sessionId: string;
  durationSec: number;
  turns: number;
  highlights: string[];
  correctionCount: number;
  xpEarned: number;
}

export interface ChatReaction {
  emoji: string;
  by: "user" | "tutor";
  ts: number;
}

export interface ReplyReference {
  id: string;
  role: "user" | "tutor";
  preview: string;
}

export type ChatMessageKind = "text" | "photo" | "voice" | "call-summary" | "system";

export interface ChatMessage {
  id: string;
  role: "user" | "tutor";
  /** 미지정이면 "text" */
  kind?: ChatMessageKind;
  text: string;
  ko?: string;
  correction?: CorrectionCard | null;
  coaching?: CoachingCard | null;
  photo?: ChatPhoto | null;
  voice?: VoiceNote | null;
  callSummary?: CallSummary | null;
  replyTo?: ReplyReference | null;
  reactions?: ChatReaction[];
  ts: number;
  read: boolean;
  proactiveType?: ProactiveType; // 튜터가 먼저 보낸 메시지의 종류
  /** 예약 발송된 메시지가 실제로 만들어진 시각 (지연 큐 진단용) */
  composedAt?: number;
}

export type ProactiveType = "morning" | "quiz" | "checkin" | "missyou" | "life" | "intro";

export interface ChatThread {
  messages: ChatMessage[];
  /** "지금 대화 중" 토글 만료 시각 (epoch ms). 지나면 지연 큐로 돌아간다. */
  liveUntil?: number;
}

// ── 비동기 발송 큐 ──
export type DeliveryReason = "reply" | "proactive" | "life" | "intro" | "voice";

export interface ScheduledMessage {
  id: string;
  tutorId: string;
  /** 메시지가 채팅방에 나타나는 시각 */
  dueAt: number;
  /** "입력 중…"을 켜기 시작할 시각 (dueAt 후반부) */
  typingFrom: number;
  createdAt: number;
  reason: DeliveryReason;
  message: ChatMessage;
  push: { title: string; body: string; url: string } | null;
}

export interface DeliveryQueue {
  pending: ScheduledMessage[];
}

// ── 사용자 상태 ──
export interface UserSettings {
  subtitles: "always" | "tap" | "off";
  speechRate: 0.8 | 1.0 | 1.2;
  notifications: { enabled: boolean; morning: boolean; quiz: boolean; checkin: boolean; life: boolean };
  /** 튜터가 먼저 보내는 하루 최대 메시지 수 (0~6, 기본 3) */
  dailyProactiveLimit: number;
  /** 한국어 입력 코칭 카드 표시 여부 */
  coachingCards: boolean;
}

/** 온보딩에서 받는 최소 프로필 — 친구 매칭의 기반이 된다. */
export interface LearnerProfile {
  ageBand: AgeBand;
  occupation: Occupation;
  interests: string[]; // 3개
  goal: LearningGoal;
  style: Temperament;
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
  /** 학습 데이터는 친구가 아니라 계정에 귀속된다. */
  profile?: LearnerProfile;
}

// ── 친구 관계 (매칭 · 이탈 · 재유입) ──
export type FriendStatus = "active" | "left";
export type LeaveReason = "mismatch" | "too-hard" | "too-easy" | "slow" | "none";

export interface RelationshipStats {
  tutorMessages: number;
  learnerMessages: number;
  /** 3단어 이하 단답 누적 — 강한 이탈 예고 신호 */
  shortReplies: number;
  calls: number;
  callSeconds: number;
  lastLearnerMessageAt: number;
  currentStreakTurns: number;
  longestStreakTurns: number;
}

export interface FriendRelation {
  tutorId: string;
  status: FriendStatus;
  addedAt: number;
  leftAt?: number;
  leaveReason?: LeaveReason;
  /** '친구의 소개'로 들어온 경우 소개자 tutorId */
  introducedBy?: string;
  stats: RelationshipStats;
}

/** 태그별 가중치 보정 — 이탈·참여 신호로 학습된다. */
export interface MatchingModel {
  weights: Record<string, number>; // 예: "temperament:lively" → -8
  updatedAt: number;
}

export interface PendingIntro {
  tutorId: string;
  dueAt: number;
  introducedBy?: string;
  reason: LeaveReason;
}

export interface FriendRoster {
  friends: FriendRelation[];
  pendingIntro: PendingIntro | null;
  model: MatchingModel;
}

export interface MatchScore {
  tutorId: string;
  score: number;
  reasons: string[];
}

// ── 라이프 스케줄 (튜터의 일상·여행) ──
export type LifeEventKind = "travel" | "work" | "weekend" | "hobby" | "daily";

export interface LifeEvent {
  id: string;
  kind: LifeEventKind;
  /** 채팅 컨텍스트에 주입되는 한국어 요약 */
  title: string;
  /** 프롬프트용 상세 서술 */
  detail: string;
  city: string;
  timezone: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  photoKeywords: string[];
  /** 이 이벤트로 이미 보낸 사진 메시지 수 */
  posts: number;
}

export interface LifeSchedule {
  tutorId: string;
  generatedAt: number;
  /** 마지막으로 커버하는 날짜 — 이 날이 가까워지면 다음 2~4주를 이어 만든다 */
  coversUntil: string;
  events: LifeEvent[];
  /** 같은 사진이 반복되지 않도록 사용 이력을 남긴다 */
  usedPhotos: string[];
  lastPostedDate: string;
  postsToday: number;
}

// ── 연결 상태 (실연동 검증) ──
export type ProviderStatus = "live" | "missing-key" | "invalid-key" | "error" | "disabled";
export type ProviderKind = "llm" | "stt" | "tts" | "push" | "photos";

export interface ProviderHealth {
  kind: ProviderKind;
  provider: string;
  status: ProviderStatus;
  detail?: string;
  checkedAt: number;
}

export interface HealthReport {
  ok: boolean;
  /** true면 실제 대화가 아니다 — 상시 배너를 띄운다 */
  demo: boolean;
  storage: "writable" | "unavailable";
  providers: ProviderHealth[];
  checkedAt: number;
}

// ── 상황극 브리핑 ──
export interface RoleplayBriefing {
  scenarioId: string;
  titleKo: string;
  situationKo: string;
  learnerRoleKo: string;
  tutorRoleKo: string;
  missionKo: string;
  expressions: { en: string; ko: string }[];
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
