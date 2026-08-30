// 대화에서 관찰한 영어를 천천히 누적해 실제 운용 레벨을 조정한다.
// 짧은 자연스러운 답 한두 개로 레벨을 내리거나, 외운 긴 문장 하나로 올리지
// 않도록 표본 수·방향성 근거·한 단계 제한을 모두 적용한다.

import { getUser, saveUser } from "./gamification";
import { readJSON, writeJSON } from "./store";
import type { CorrectionCard, Judgment, Mode, SessionRecord } from "./types";

const PROFILE_KEY = "learner-level-adaptation";
const PROFILE_VERSION = 1;
const ANCHOR_WEIGHT = 3;

export interface LearnerLevelEvidence {
  estimatedLevel: number;
  weight: number;
  wordCount: number;
  reasons: string[];
}

export interface LearnerLevelProfile {
  version: number;
  anchorLevel: number;
  estimate: number;
  evidenceWeight: number;
  samples: number;
  upwardSignals: number;
  downwardSignals: number;
  lastObservedAt: number;
  lastLevelChangeAt?: number;
}

export interface LevelPolicy {
  level: number;
  maxSentences: number;
  maxWords: number;
  replyWordBudget: string;
  vocabulary: string;
  question: string;
  correction: string;
  repetition: string;
  correctionCadence: number;
  baseSpeechRate: number;
}

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "do", "for", "from", "had", "has", "have",
  "he", "her", "him", "his", "i", "in", "is", "it", "me", "my", "of", "on", "or", "our", "she", "so",
  "that", "the", "their", "them", "they", "this", "to", "was", "we", "were", "with", "you", "your",
]);

const COMPLEX_CONNECTORS = /\b(?:although|unless|whereas|however|therefore|despite|while|whenever|whether|because|since|which|who|even though|in order to|rather than)\b/gi;
const ADVANCED_PATTERNS = [
  /\b(?:have|has|had) been\b/i,
  /\bif\b[^.!?]{0,80}\b(?:would|could|might)\b/i,
  /\b(?:would rather|used to|be supposed to|wish i|not only)\b/i,
  /\b(?:nevertheless|consequently|perspective|significant|particularly|eventually|apparently)\b/i,
];

function clampLevel(value: number): number {
  return Math.max(1, Math.min(5, Number.isFinite(value) ? value : 2));
}

function rounded(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function freshProfile(level: number, lastLevelChangeAt?: number): LearnerLevelProfile {
  const anchorLevel = Math.round(clampLevel(level));
  return {
    version: PROFILE_VERSION,
    anchorLevel,
    estimate: anchorLevel,
    evidenceWeight: ANCHOR_WEIGHT,
    samples: 0,
    upwardSignals: 0,
    downwardSignals: 0,
    lastObservedAt: 0,
    ...(lastLevelChangeAt ? { lastLevelChangeAt } : {}),
  };
}

function isValidProfile(value: unknown): value is LearnerLevelProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<LearnerLevelProfile>;
  return profile.version === PROFILE_VERSION
    && Number.isFinite(profile.anchorLevel)
    && Number.isFinite(profile.estimate)
    && Number.isFinite(profile.evidenceWeight)
    && Number.isFinite(profile.samples)
    && Number.isFinite(profile.upwardSignals)
    && Number.isFinite(profile.downwardSignals);
}

export function getLearnerLevelProfile(level = getUser().level): LearnerLevelProfile {
  const anchor = Math.round(clampLevel(level));
  const stored = readJSON<unknown>(PROFILE_KEY, null);
  if (!isValidProfile(stored) || stored.anchorLevel !== anchor) return freshProfile(anchor);
  return { ...stored };
}

export function resetLearnerLevelProfile(level: number): LearnerLevelProfile {
  const profile = freshProfile(level);
  writeJSON(PROFILE_KEY, profile);
  return profile;
}

/**
 * 한 발화의 대략적인 난이도 신호. 이는 시험 점수가 아니라 누적 보정용 신호다.
 * 인사, 한두 단어 응답, 한국어 중심 발화, 따라 말하기는 애초에 표본으로 쓰지 않는다.
 */
export function inferLearnerLevelEvidence(
  text: string,
  correction: CorrectionCard | null = null,
): LearnerLevelEvidence | null {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean || clean.length > 2_000) return null;
  if (/^(?:hi|hello|hey|thanks?|thank you|yes|yeah|yep|no|nope|okay|ok|bye|goodbye)[!.~ ]*$/i.test(clean)) return null;

  const words = clean.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) ?? [];
  const hangulCount = (clean.match(/[가-힣]/g) ?? []).length;
  if (words.length < 3 || hangulCount > words.join("").length / 2) return null;

  const lowerWords = words.map((word) => word.toLowerCase());
  const contentWords = lowerWords.filter((word) => !STOP_WORDS.has(word));
  const uniqueRatio = contentWords.length > 0 ? new Set(contentWords).size / contentWords.length : 0;
  const connectorCount = (clean.match(COMPLEX_CONNECTORS) ?? []).length;
  const advancedCount = ADVANCED_PATTERNS.filter((pattern) => pattern.test(clean)).length;

  let estimatedLevel = words.length <= 4
    ? 1.8
    : words.length <= 7
      ? 2.2
      : words.length <= 11
        ? 2.7
        : words.length <= 17
          ? 3.2
          : words.length <= 25
            ? 3.7
            : words.length <= 35
              ? 4.15
              : 4.55;
  const reasons = [`${words.length} English words`];

  if (connectorCount > 0) {
    estimatedLevel += Math.min(0.5, connectorCount * 0.16);
    reasons.push(`${connectorCount} clause connector(s)`);
  }
  if (advancedCount > 0) {
    estimatedLevel += Math.min(0.45, advancedCount * 0.2);
    reasons.push(`${advancedCount} advanced structure(s)`);
  }
  if (words.length >= 10 && uniqueRatio >= 0.72) {
    estimatedLevel += 0.12;
    reasons.push("varied vocabulary");
  }
  if (correction) {
    const penalty = correction.type === "awkward" || correction.type === "word-choice" ? 0.18 : 0.35;
    estimatedLevel -= penalty;
    reasons.push(`${correction.type} correction`);
  }

  // 짧지만 완전한 일상 답변은 낮은 레벨의 확정 근거가 아니다.
  const weight = words.length <= 6 && !correction
    ? 0.25
    : Math.min(1.8, 0.35 + words.length / 18 + connectorCount * 0.08 + advancedCount * 0.12);

  return {
    estimatedLevel: rounded(clampLevel(estimatedLevel)),
    weight: rounded(weight),
    wordCount: words.length,
    reasons,
  };
}

export interface RecordLevelEvidenceInput {
  text: string;
  mode: Mode;
  correction?: CorrectionCard | null;
  judgment?: Judgment;
  isGreeting?: boolean;
  externalConversation?: boolean;
}

export interface RecordLevelEvidenceResult {
  observed: boolean;
  previousLevel: number;
  level: number;
  estimate: number;
  changed: boolean;
}

export function recordLearnerLevelEvidence(input: RecordLevelEvidenceInput): RecordLevelEvidenceResult {
  if (input.externalConversation) {
    return { observed: false, previousLevel: 2, level: 2, estimate: 2, changed: false };
  }
  const currentUser = getUser();
  const currentLevel = Math.round(clampLevel(currentUser.level));
  const unchanged = (estimate = currentLevel): RecordLevelEvidenceResult => ({
    observed: false,
    previousLevel: currentLevel,
    level: currentLevel,
    estimate,
    changed: false,
  });

  // 외부 채널, 연결 인사, 따라 말하기, 커리큘럼의 모범문장 재현은 로컬 능력
  // 추정이나 프로필 저장에 절대 사용하지 않는다.
  if (input.isGreeting || input.judgment || input.mode === "learning") return unchanged();

  const evidence = inferLearnerLevelEvidence(input.text, input.correction ?? null);
  if (!evidence) return unchanged();

  let profile = getLearnerLevelProfile(currentLevel);
  // 전체 사용 기간의 평균으로 굳어 버리지 않게 최근 대화가 의미 있는 비중을
  // 갖도록 누적 질량을 부드럽게 감쇠한다. 레벨 변경 자체는 아래 최소 방향성
  // 표본 조건을 별도로 통과해야 하므로 한두 턴의 급변은 여전히 불가능하다.
  if (profile.evidenceWeight > 16) {
    const scale = 12 / profile.evidenceWeight;
    profile.evidenceWeight = 12;
    profile.samples = Math.floor(profile.samples * scale);
    profile.upwardSignals = Math.floor(profile.upwardSignals * scale);
    profile.downwardSignals = Math.floor(profile.downwardSignals * scale);
  }
  const totalWeight = profile.evidenceWeight + evidence.weight;
  profile.estimate = rounded(
    (profile.estimate * profile.evidenceWeight + evidence.estimatedLevel * evidence.weight) / totalWeight,
  );
  profile.evidenceWeight = rounded(totalWeight);
  profile.samples += 1;
  profile.lastObservedAt = Date.now();

  if (
    !input.correction
    && evidence.wordCount >= 10
    && evidence.estimatedLevel >= currentLevel + 0.55
  ) {
    profile.upwardSignals += 1;
  }
  if (
    input.correction
    && evidence.estimatedLevel <= currentLevel - 0.55
  ) {
    profile.downwardSignals += 1;
  }

  const canMoveUp = currentLevel < 5
    && profile.samples >= 6
    && profile.upwardSignals >= 4
    && profile.estimate >= currentLevel + 0.55;
  const canMoveDown = currentLevel > 1
    && profile.samples >= 8
    && profile.downwardSignals >= 5
    && profile.estimate <= currentLevel - 0.65;
  const nextLevel = canMoveUp ? currentLevel + 1 : canMoveDown ? currentLevel - 1 : currentLevel;

  if (nextLevel !== currentLevel) {
    // XP/설정 등 다른 필드를 덮어쓰지 않도록 저장 직전에 최신 user를 다시 읽는다.
    const latestUser = getUser();
    if (Math.round(clampLevel(latestUser.level)) === currentLevel) {
      latestUser.level = nextLevel;
      saveUser(latestUser);
      const changedAt = Date.now();
      const observedEstimate = profile.estimate;
      profile = freshProfile(nextLevel, changedAt);
      writeJSON(PROFILE_KEY, profile);
      return {
        observed: true,
        previousLevel: currentLevel,
        level: nextLevel,
        estimate: observedEstimate,
        changed: true,
      };
    }
    profile = freshProfile(latestUser.level);
  }

  writeJSON(PROFILE_KEY, profile);
  return {
    observed: true,
    previousLevel: currentLevel,
    level: currentLevel,
    estimate: profile.estimate,
    changed: false,
  };
}

const LEVEL_POLICIES: Readonly<Record<number, Omit<LevelPolicy, "level" | "correctionCadence">>> = {
  1: {
    maxSentences: 2,
    maxWords: 24,
    replyWordBudget: "보통 8~18단어, 절대 24단어를 넘기지 않음",
    vocabulary: "A1 핵심 어휘와 현재형 중심. 관용구·추상어는 쓰지 말고 새 단어는 한 번에 하나만",
    question: "yes/no 또는 두 선택지 질문을 우선하고 질문 자체는 짧게",
    correction: "뜻을 막는 핵심 오류만 하나 고치고 better 문장은 8단어 안팎으로 제시",
    repetition: "짧은 모범문장은 도움이 필요할 때만 한 번 제안하고, 일반 답변을 따라 말하기로 오인하지 않음",
    baseSpeechRate: 0.84,
  },
  2: {
    maxSentences: 2,
    maxWords: 34,
    replyWordBudget: "보통 12~26단어, 절대 34단어를 넘기지 않음",
    vocabulary: "A2 일상 어휘와 짧은 연결어(because, but, so)를 사용",
    question: "한 가지 정보만 묻는 간단한 wh-질문 또는 선택 질문",
    correction: "의미에 영향이 큰 기초 문법·시제·전치사 중 하나만 부드럽게 재진술",
    repetition: "막혔거나 목표 표현 연습 단계일 때만 짧은 문장 하나를 제안",
    baseSpeechRate: 0.92,
  },
  3: {
    maxSentences: 3,
    maxWords: 50,
    replyWordBudget: "보통 20~40단어, 절대 50단어를 넘기지 않음",
    vocabulary: "B1 일상 어휘와 이유·경험을 잇는 자연스러운 연결 표현을 사용",
    question: "방금 답의 이유나 구체적 예시를 묻는 후속 질문 하나",
    correction: "반복되거나 활용도가 높은 오류 하나만 교정하고 대화 흐름을 유지",
    repetition: "더 좋은 표현은 유용성이 분명할 때만 제안하며 매 턴 과제로 만들지 않음",
    baseSpeechRate: 1,
  },
  4: {
    maxSentences: 3,
    maxWords: 62,
    replyWordBudget: "보통 24~50단어, 절대 62단어를 넘기지 않음",
    vocabulary: "B2 수준의 구동사·연어를 자연스럽게 쓰되 드문 관용구는 문맥으로 이해 가능하게",
    question: "비교·가정·관점을 확장하는 질문 하나",
    correction: "문법 나열보다 어색한 연어·어휘 선택·자연스러움을 한 군데 정밀하게 개선",
    repetition: "이미 뜻이 통하면 반복을 요구하지 말고 선택 가능한 자연스러운 대안으로 제시",
    baseSpeechRate: 1.06,
  },
  5: {
    maxSentences: 3,
    maxWords: 70,
    replyWordBudget: "보통 28~58단어, 절대 70단어를 넘기지 않음",
    vocabulary: "C1에 가까운 자연스러운 회화, 뉘앙스·레지스터·관용적 연어를 허용",
    question: "함의·관점·가정을 파고드는 질문 하나이되 복합 질문으로 두 개를 묻지 않음",
    correction: "정답 문법보다 뉘앙스·레지스터·간결성에서 실제 가치가 있는 한 군데만 코칭",
    repetition: "따라 말하기보다 재표현·즉흥 응답을 우선하고 명시적 연습에서만 모범문장을 반복",
    baseSpeechRate: 1.12,
  },
};

export function getLevelPolicy(level: number, mode: Mode): LevelPolicy {
  const normalized = Math.round(clampLevel(level));
  const base = LEVEL_POLICIES[normalized];
  const cadence = mode === "learning"
    ? 1
    : mode === "chat"
      ? [4, 3, 3, 2, 2][normalized - 1]
      : [3, 3, 2, 2, 2][normalized - 1];
  return {
    level: normalized,
    ...base,
    maxSentences: mode === "chat" ? Math.min(2, base.maxSentences) : base.maxSentences,
    correctionCadence: cadence,
  };
}

/** 현재 새 발화까지 포함해 교정 카드 간 최소 간격이 지났는지 계산한다. */
export function correctionAllowedForTurn(session: SessionRecord, level: number): boolean {
  if (session.mode === "learning") return true;
  const cadence = getLevelPolicy(level, session.mode).correctionCadence;
  let learnerTurnsIncludingCurrent = 1;
  for (let index = session.turns.length - 1; index >= 0; index--) {
    const turn = session.turns[index];
    // 통화 세션은 tutor 턴에, 메신저 영속 모델은 해당 user 메시지에 교정
    // 카드를 보관한다. 어느 표현이든 같은 빈도 예산으로 해석한다.
    if (turn.correction) return learnerTurnsIncludingCurrent >= cadence;
    if (turn.role === "user") learnerTurnsIncludingCurrent += 1;
  }
  return true;
}

export function correctionMatchesUtterance(correction: CorrectionCard, userText: string): boolean {
  const normalize = (value: string) => value
    .toLowerCase()
    .replace(/[^a-z0-9가-힣']+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const original = normalize(correction.original);
  const utterance = normalize(userText);
  if (original.length === 0 || utterance.length === 0) return false;
  const utteranceSet = new Set(utterance);
  const overlap = original.filter((word) => utteranceSet.has(word)).length;
  return overlap / Math.max(1, Math.min(original.length, utterance.length)) >= 0.55;
}

/** 사용자 속도 선호는 유지하면서 레벨별 기본 발화 속도를 실제 TTS 배율로 합성한다. */
export function effectiveSpeechRate(level: number, preference = 1): number {
  const policy = getLevelPolicy(level, "freetalk");
  const safePreference = Number.isFinite(preference) ? Math.max(0.8, Math.min(1.2, preference)) : 1;
  return rounded(Math.max(0.75, Math.min(1.25, policy.baseSpeechRate * safePreference)));
}
