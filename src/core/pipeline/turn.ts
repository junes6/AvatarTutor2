// 대화 턴 처리기 — STT 이후의 모든 것: 프롬프트 조립 → LLM → 파싱 → 학습 엔진 반영.
// UI 없이도 실행 가능 (scripts/simulate.ts 에서 그대로 사용).

import { chatLLM, type LLMMessage } from "../llm";
import { buildSystemPrompt } from "./systemPrompt";
import { sanitizeTurnOutput } from "./parse";
import { hasExplicitEndIntent } from "./intent";
import { applyTurn, type StageOutcome } from "../learning/engine";
import { addXp, addIntimacy, getUser, saveUser } from "../gamification";
import {
  correctionAllowedForTurn,
  correctionMatchesUtterance,
  getLevelPolicy,
  recordLearnerLevelEvidence,
} from "../levelAdaptation";
import { uid } from "../store";
import type { SessionRecord, TurnResult, Judgment, TurnLog, TutorTurnOutput, TokenUsage } from "../types";

const HISTORY_LIMIT = 24;
const RECENT_REPLY_LIMIT = 5;

function normalizedWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9가-힣' ]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1);
}

function replySimilarity(a: string, b: string): number {
  const left = new Set(normalizedWords(a));
  const right = new Set(normalizedWords(b));
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  for (const word of left) if (right.has(word)) overlap++;
  return (2 * overlap) / (left.size + right.size);
}

function isKoreanDominant(text: string): boolean {
  const korean = text.match(/[가-힣]/g)?.length ?? 0;
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0;
  return korean > 0 && korean >= latin;
}

function tutorRequestedTravelDocument(text: string): boolean {
  return /passport|travel document|photo id/i.test(text)
    && !/which city|destination|where are you flying/i.test(text);
}

function signalsMissingTravelDocument(text: string, previousTutorReply = ""): boolean {
  const explicitPassportProblem = /(?:\b(?:forgot|forget|lost|misplaced|don'?t have|do not have|can'?t find|cannot find|didn'?t bring|did not bring)\b[^.!?]{0,48}\bpassport\b)|(?:\bpassport\b[^.!?]{0,48}\b(?:forgotten|lost|misplaced|missing|at home|not with me)\b)|(?:\bno passport\b)|(?:여권[^.!?]*(?:깜빡|잊|분실|잃|없|안\s*(?:가져|챙겨)))/i.test(text);
  if (explicitPassportProblem) return true;
  if (!tutorRequestedTravelDocument(previousTutorReply)) return false;
  // Recover short or noisy answers whose omitted object is supplied by the
  // immediately preceding passport request (for example STT's
  // "sorry I'm I'm forgot forgot"). Do not reinterpret a named missing item.
  return /^(?:sorry[, ]*)?(?:i(?:'m| am)?\s*)*(?:forgot|forget|lost|misplaced)(?:\s+(?:it|that|forgot))*[.!\s]*$/i.test(text.trim())
    || /^(?:죄송(?:해요|합니다)?[, ]*)?(?:깜빡했어요|잊었어요|잃어버렸어요|없어요)[.!\s]*$/i.test(text.trim());
}

function signalsTravelDocumentPresented(text: string): boolean {
  return /\b(?:here (?:it|you) (?:is|go)|here(?:'s| is) my (?:passport|travel document|photo id)|this is my (?:passport|travel document|photo id)|my passport is here|i (?:found|have|brought) (?:it|my passport))\b/i.test(text);
}

function confirmsTravelDocumentWithoutPresentation(reply: string): boolean {
  return /\b(?:have|received|checked|confirmed|see|got)\b\s+(?:your\s+)?(?:passport|travel document|photo id)|(?:passport|travel document|photo id)\s+(?:is\s+)?(?:received|confirmed|checked|valid)/i.test(reply);
}

function advancesPastPassportStep(reply: string): boolean {
  return /which city|where are you flying|destination|how many bags|checked bags?|window or aisle|seat preference|boarding pass|check-?in (?:is )?(?:complete|done)|all set/i.test(reply);
}

function keepsDestinationUnresolved(reply: string): boolean {
  return /need (?:a )?city(?: name)?|which city|city name|where are you flying|clarif|not sure (?:which|what)|can'?t confirm.*destination/i.test(reply);
}

interface QualityContext {
  userText: string;
  scenarioId?: string;
  previousTutorReply?: string;
  requiresKoreanSuggestion?: boolean;
}

function scenarioGroundingIssues(output: TutorTurnOutput, context?: QualityContext): string[] {
  const issues: string[] = [];
  if (!context) return issues;
  const { userText, previousTutorReply = "" } = context;

  if (
    context.requiresKoreanSuggestion
    && isKoreanDominant(userText)
    && !hasExplicitEndIntent(userText)
    && (!output.suggestion?.en || /[가-힣]/.test(output.suggestion.en))
  ) {
    issues.push("학습자가 한국어로 말했는데 자연스러운 영어 표현 suggestion이 없습니다. 뜻에 맞는 영어 한 문장을 제안하세요.");
  }
  if (!context.scenarioId) return issues;

  if (
    context.scenarioId === "airport"
    && signalsMissingTravelDocument(userText, previousTutorReply)
    && !/(?:can'?t|cannot|must|need|until|without)[^.!?]*(?:passport|travel document|check-?in)|(?:retrieve|bring|find|show)[^.!?]*(?:it|passport)|check-?in[^.!?]*(?:pause|wait|complete)/i.test(output.reply)
  ) {
    issues.push("학습자가 여권 누락·분실을 말했는데 해결되지 않은 여권 단계를 유지하지 않았습니다. 누락을 인정하고 현재 단계에서 복구하세요.");
  }

  if (
    context.scenarioId === "airport"
    && tutorRequestedTravelDocument(previousTutorReply)
    && !signalsTravelDocumentPresented(userText)
    && (confirmsTravelDocumentWithoutPresentation(output.reply) || advancesPastPassportStep(output.reply))
  ) {
    issues.push("학습자가 아직 여권을 제시하지 않았는데 다음 체크인 단계로 진행했습니다. 실제 제시를 요청하세요.");
  }

  const destinationWasRequested = /which city|destination|where are you flying/i.test(previousTutorReply);
  const numberOnly = /^(?:\d+(?:\.\d+)?|one hundred|hundred)[.!\s]*$/i.test(userText.trim());
  if (
    context.scenarioId === "airport"
    && destinationWasRequested
    && numberOnly
    && !keepsDestinationUnresolved(output.reply)
  ) {
    issues.push("도시를 묻는 질문에 숫자만 답했는데 목적지로 확정했습니다. 숫자를 확정하지 말고 도시 이름을 다시 물으세요.");
  }
  return issues;
}

function qualityIssues(
  output: TutorTurnOutput,
  recentReplies: string[],
  budget?: { maxSentences: number; maxWords: number },
  context?: QualityContext,
): string[] {
  const issues: string[] = scenarioGroundingIssues(output, context);
  const questionCount = (output.reply.match(/\?/g) ?? []).length;
  if (questionCount > 1) issues.push(`질문이 ${questionCount}개입니다. 질문은 하나만 남기세요.`);

  const repeated = recentReplies.find((reply) => replySimilarity(output.reply, reply) >= 0.72);
  if (repeated) issues.push(`최근 발화 "${repeated.slice(0, 140)}"와 너무 비슷합니다.`);
  if (budget) {
    const sentences = output.reply.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.filter((part) => part.trim()) ?? [];
    const words = output.reply.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g)?.length ?? 0;
    if (sentences.length > budget.maxSentences) {
      issues.push(`현재 레벨의 최대 ${budget.maxSentences}문장을 넘었습니다.`);
    }
    if (words > budget.maxWords) issues.push(`현재 레벨의 최대 ${budget.maxWords}단어를 넘었습니다.`);
  }
  return issues;
}

/**
 * 모델 재생성까지 같은 사실 모순이 남았을 때 사용자에게 거짓 완료를 노출하지
 * 않기 위한 마지막 안전망. 공항 시나리오의 고위험 슬롯만 보수적으로 다룬다.
 */
export function applyScenarioGroundingGuard(
  output: TutorTurnOutput,
  scenarioId: string | undefined,
  userText: string,
  previousTutorReply = "",
): TutorTurnOutput {
  if (scenarioId !== "airport") return output;

  if (
    signalsMissingTravelDocument(userText, previousTutorReply)
  ) {
    return {
      ...output,
      reply: "I understand—you don't have your passport, so I can't complete check-in yet. Can you retrieve it?",
      reply_ko: "여권이 없으시군요. 지금은 체크인을 완료할 수 없어요. 여권을 가져올 수 있나요?",
      end_call: false,
    };
  }

  if (
    tutorRequestedTravelDocument(previousTutorReply)
    && !signalsTravelDocumentPresented(userText)
    && (confirmsTravelDocumentWithoutPresentation(output.reply) || advancesPastPassportStep(output.reply))
  ) {
    return {
      ...output,
      reply: "I still need to see your passport before we continue. Please show it when you're ready.",
      reply_ko: "계속 진행하려면 아직 여권을 확인해야 해요. 준비되면 여권을 보여주세요.",
      end_call: false,
    };
  }

  const destinationWasRequested = /which city|destination|where are you flying/i.test(previousTutorReply);
  const numberOnly = /^(?:\d+(?:\.\d+)?|one hundred|hundred)[.!\s]*$/i.test(userText.trim());
  if (
    destinationWasRequested
    && numberOnly
  ) {
    return {
      ...output,
      reply: `I heard "${userText.trim()}," but I need a city name. Which city are you flying to?`,
      reply_ko: "방금 답은 도시 이름으로 확인할 수 없어요. 어느 도시로 가시나요?",
      end_call: false,
    };
  }
  return output;
}

function limitToOneQuestion(reply: string): string {
  const firstQuestion = reply.indexOf("?");
  if (firstQuestion === -1 || reply.indexOf("?", firstQuestion + 1) === -1) return reply;
  // 첫 질문을 건넨 시점이 자연스러운 발화권 양도 지점이다. 이후 질문/과제는
  // 다음 턴으로 미뤄 사용자가 답할 틈을 보장한다.
  let end = firstQuestion + 1;
  while (end < reply.length && /["'”’)}\]]/.test(reply[end])) end++;
  return reply.slice(0, end).trim();
}

export function limitReplyToLevelBudget(reply: string, maxSentences: number, maxWords: number): string {
  const sentences = reply.match(/[^.!?]+[.!?]+(?:["'”’)}\]]*)|[^.!?]+$/g)?.map((part) => part.trim()).filter(Boolean) ?? [reply];
  const sentenceLimit = Math.max(1, maxSentences);
  let selected = sentences.slice(0, sentenceLimit);
  // 대화권을 넘기는 질문은 앞의 감탄·부연보다 중요하다. 질문이 뒤쪽에 있어
  // 문장 상한 밖으로 밀린 경우 마지막 자리를 질문에 양보한다.
  const firstQuestionIndex = sentences.findIndex((sentence) => sentence.includes("?"));
  if (firstQuestionIndex >= 0 && !selected.includes(sentences[firstQuestionIndex])) {
    selected = sentenceLimit === 1
      ? [sentences[firstQuestionIndex]]
      : [...selected.slice(0, sentenceLimit - 1), sentences[firstQuestionIndex]];
  }

  let limited = selected.join(" ").trim();
  const words = limited.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return limited;

  // 단어 상한에서도 질문을 중간에서 자르거나 통째로 버리지 않는다. 질문 전체를
  // 먼저 확보하고, 남은 예산에 완전한 문장으로 들어가는 앞 문맥만 유지한다.
  const selectedQuestionIndex = selected.findIndex((sentence) => sentence.includes("?"));
  if (selectedQuestionIndex >= 0) {
    const question = selected[selectedQuestionIndex];
    const questionWords = question.split(/\s+/).filter(Boolean).length;
    if (questionWords >= maxWords) return question;
    let remaining = maxWords - questionWords;
    const kept = selected
      .map((sentence, index) => ({ sentence, index }))
      .filter(({ index }) => index !== selectedQuestionIndex)
      .filter(({ sentence }) => {
        const count = sentence.split(/\s+/).filter(Boolean).length;
        if (count > remaining) return false;
        remaining -= count;
        return true;
      });
    kept.push({ sentence: question, index: selectedQuestionIndex });
    return kept.sort((a, b) => a.index - b.index).map(({ sentence }) => sentence).join(" ").trim();
  }

  limited = words.slice(0, maxWords).join(" ").replace(/[,:;\-–—]+$/, "").trim();
  return `${limited.replace(/[.!?]+$/, "")}.`;
}

function sumUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return { inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens };
}

export interface RunTurnInput {
  session: SessionRecord; // 직접 수정됨 — 호출자가 저장 책임
  userText: string;
  clientTurnId?: string;
  judgment?: Judgment; // 따라 말하기 턴이면 라우트에서 계산해 전달
  isGreeting?: boolean; // 통화 연결 직후 튜터 첫 인사 (userText는 기록되지 않음)
  externalConversation?: boolean; // 외부 채널: 로컬 프로필/기억/보상과 완전 격리
  lifeContext?: string; // 채팅: 튜터의 현재 일정/위치
  deliveryNote?: string; // 채팅: 늦게 답하는 이유 (수면/여행)
  turnNotes?: string[]; // 채팅: 이번 턴에만 적용되는 추가 지침
  signal?: AbortSignal; // 외부 채널/요청 전체 deadline 전파
}

export async function runTurn(input: RunTurnInput): Promise<TurnResult & { events: string[] }> {
  const { session } = input;
  // 외부 채널에서는 로컬 사용자 상태를 읽지 않는다. 중립 레벨은 시스템 프롬프트와 동일하다.
  const learnerLevel = input.externalConversation ? 2 : getUser().level;
  const correctionAllowed = correctionAllowedForTurn(session, learnerLevel);
  const levelPolicy = getLevelPolicy(learnerLevel, session.mode);
  const replyBudget = session.mode === "learning" || input.isGreeting
    ? undefined
    : { maxSentences: levelPolicy.maxSentences, maxWords: levelPolicy.maxWords };
  const promptContext = {
    userText: input.userText,
    isGreeting: input.isGreeting,
    externalConversation: input.externalConversation,
    lifeContext: input.lifeContext,
    deliveryNote: input.deliveryNote,
    turnNotes: input.turnNotes,
  };
  const system = buildSystemPrompt(session, input.judgment, promptContext);

  const history: LLMMessage[] = session.turns
    .slice(-HISTORY_LIMIT)
    .map((t) => ({ role: t.role === "user" ? ("user" as const) : ("assistant" as const), content: t.text }));

  history.push({ role: "user", content: input.userText });

  let llm = await chatLLM({
    system,
    messages: history,
    maxTokens: 1024,
    feature: session.mode === "learning" ? "learning-turn" : session.mode === "chat" ? "chat-turn" : "freetalk-turn",
    signal: input.signal,
  });

  let output = sanitizeTurnOutput(llm.text);
  const recentReplies = session.turns
    .filter((turn) => turn.role === "tutor")
    .slice(-RECENT_REPLY_LIMIT)
    .map((turn) => turn.text);
  const previousTutorReply = recentReplies.at(-1) ?? "";
  const qualityContext: QualityContext = {
    userText: input.userText,
    scenarioId: input.isGreeting ? undefined : session.scenarioId,
    previousTutorReply,
    requiresKoreanSuggestion: !input.isGreeting && session.mode === "freetalk",
  };
  const firstIssues = qualityIssues(output, recentReplies, replyBudget, qualityContext);

  // 반복 문구나 질문 폭탄은 그대로 노출하지 않고 한 번만 재생성한다.
  // 두 번째 후보도 완벽하지 않으면 문제 수가 더 적은 후보를 선택한다.
  if (firstIssues.length > 0) {
    const retryReason = [
      ...firstIssues,
      `거절된 이전 후보: "${output.reply.slice(0, 240)}"`,
      "학습자의 최신 발화에 대한 구체적인 반응으로 시작해 완전히 새로 쓰세요.",
    ].join(" ");
    const retrySystem = buildSystemPrompt(session, input.judgment, { ...promptContext, retryReason });
    const retry = await chatLLM({
      system: retrySystem,
      messages: history,
      maxTokens: 1024,
      feature: `${session.mode}-turn-retry`,
      signal: input.signal,
    });
    const retryOutput = sanitizeTurnOutput(retry.text);
    const retryIssues = qualityIssues(retryOutput, recentReplies, replyBudget, qualityContext);
    if (retryIssues.length <= firstIssues.length) output = retryOutput;
    llm = { ...llm, usage: sumUsage(llm.usage, retry.usage) };
  }

  output = applyScenarioGroundingGuard(output, session.scenarioId, input.userText, previousTutorReply);

  const limitedReply = limitToOneQuestion(output.reply);
  if (limitedReply !== output.reply) {
    output.reply = limitedReply;
    // 문장 단위 대응을 보장할 수 없는 번역을 그대로 두면, 잘려 나간 두 번째
    // 질문이 한국어 자막에만 남는다. 재생성 안전망 이후에도 위반한 드문 경우는
    // 모순된 자막을 보여주지 않는 쪽을 택한다.
    output.reply_ko = "";
  }
  if (replyBudget) {
    const levelLimitedReply = limitReplyToLevelBudget(output.reply, replyBudget.maxSentences, replyBudget.maxWords);
    if (levelLimitedReply !== output.reply) {
      output.reply = levelLimitedReply;
      output.reply_ko = "";
    }
  }

  // 모델이 빈도 예산을 어기거나 실제 발화와 무관한 교정을 만들더라도 카드가
  // 노출·저장되지 않게 런타임에서 한 번 더 강제한다.
  const groundedCorrection = output.correction && correctionMatchesUtterance(output.correction, input.userText)
    ? output.correction
    : null;
  output.correction = correctionAllowed ? groundedCorrection : null;

  // 자유대화/메신저의 일반 suggestion은 다음 발화를 따라 말하기로 오인시킬 수
  // 있어 제거한다. 다만 프리토킹 중 사용자가 한국어로 막힌 턴은 영어 표현을
  // 바로 듣고 따라 해보는 것이 명시적 학습 의도이므로 한 문장을 보존한다.
  const preservesFreetalkKoreanHelp = session.mode === "freetalk"
    && isKoreanDominant(input.userText)
    && !!output.suggestion?.en
    && !/[가-힣]/.test(output.suggestion.en);
  if (session.mode !== "learning") {
    if (!preservesFreetalkKoreanHelp) output.suggestion = null;
    output.new_expression = null;
    output.used_expressions = [];
    output.stage_signal = "stay";
  }

  const userRequestedEnd = !input.isGreeting && hasExplicitEndIntent(input.userText);
  const learningIsDone = session.mode === "learning" && session.stageState?.stage === "done";
  if (userRequestedEnd) {
    output.end_call = true;
    output.new_expression = null;
    output.used_expressions = [];
    output.suggestion = null;
    output.stage_signal = "stay";
    // 종료 의사를 받았는데 모델이 새 질문을 한 경우에는 진행을 확실히 멈춘다.
    if (output.reply.includes("?")) {
      output.reply = "It was great talking with you. Take care, and see you next time!";
      output.reply_ko = "얘기해서 즐거웠어요. 잘 지내고, 다음에 또 만나요!";
    }
  } else if (!learningIsDone) {
    // 모델이 준비된 대본을 끝냈다는 이유만으로 통화를 일방 종료하지 못하게 한다.
    output.end_call = false;
  }

  // ── 학습 엔진 반영 ──
  let outcome: StageOutcome = { xpGained: 0, events: [] };
  if (session.mode === "learning" && session.unitId && session.stageState) {
    outcome = applyTurn(session.stageState, session.unitId, output, input.judgment);
  }
  if (preservesFreetalkKoreanHelp) {
    outcome.events.push(session.scenarioId ? "scenario-expression-help" : "freetalk-expression-help");
  }

  // ── 세션 기록 ──
  if (!input.isGreeting) {
    const userLog: TurnLog = {
      id: uid("t"),
      role: "user",
      text: input.userText,
      clientTurnId: input.clientTurnId,
      ts: Date.now(),
      judgment: input.judgment,
    };
    session.turns.push(userLog);
  }
  const tutorLog: TurnLog = {
    id: uid("t"),
    role: "tutor",
    text: output.reply,
    ko: output.reply_ko,
    ts: Date.now(),
    correction: output.correction,
    suggestion: output.suggestion,
    usage: llm.usage,
  };
  session.turns.push(tutorLog);

  if (output.correction) session.corrections.push(output.correction);
  if (input.judgment) {
    session.judgments.push(input.judgment);
    session.pronunciationScores.push(input.judgment.score);
  }

  // ── XP / 친밀도 / 오늘의 목표 ──
  // 외부 채널은 로컬 앱 사용자의 진도와 관계 상태를 읽거나 쓰지 않는다.
  if (!input.externalConversation) {
    let xp = outcome.xpGained;
    if (!input.isGreeting) xp += 2; // 발화 자체에 소량 XP
    session.xpEarned += xp;
    if (xp > 0) addXp(xp);
    if (!input.isGreeting) addIntimacy(session.tutorId, outcome.events.includes("unit-clear") ? 11 : 1);

    const reviewPasses = outcome.events.filter((e) => e === "review-pass").length;
    if (reviewPasses > 0 || outcome.events.includes("unit-clear")) {
      const u = getUser();
      u.dailyGoal.reviewsDone += reviewPasses;
      if (outcome.events.includes("unit-clear")) u.dailyGoal.unitDone = true;
      saveUser(u);
    }

    const levelUpdate = recordLearnerLevelEvidence({
      text: input.userText,
      mode: session.mode,
      correction: groundedCorrection,
      judgment: input.judgment,
      isGreeting: input.isGreeting || userRequestedEnd,
    });
    if (levelUpdate.changed) {
      outcome.events.push(levelUpdate.level > levelUpdate.previousLevel ? "level-adapted-up" : "level-adapted-down");
    }
  }

  return { ...output, usage: llm.usage, judgment: input.judgment, events: outcome.events };
}

/** 통화 연결 직후 튜터의 첫 인사 */
export async function greetTurn(session: SessionRecord, signal?: AbortSignal): Promise<TurnResult & { events: string[] }> {
  return runTurn({
    session,
    userText:
      "(시스템: 방금 영상통화가 연결되었습니다. 학습자는 아직 아무 말도 하지 않았습니다. 페르소나와 현재 모드에 맞는 첫 인사로 대화를 시작해 주세요.)",
    isGreeting: true,
    signal,
  });
}
