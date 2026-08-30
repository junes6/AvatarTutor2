// 모드별 시스템 프롬프트 조립 — 모든 내용은 /prompts/*.md 에서 온다.

import { loadPrompt } from "../prompts";
import { getPersona, getScenario, getUnit } from "../content";
import { getUser, getTutorState, intimacyLevel } from "../gamification";
import { formatMemory } from "../memory";
import { correctionAllowedForTurn, getLevelPolicy } from "../levelAdaptation";
import { offTopicStreak, recoveryHint } from "../roleplay";
import type { SessionRecord, Judgment } from "../types";

export interface TurnPromptContext {
  userText: string;
  isGreeting?: boolean;
  retryReason?: string;
  externalConversation?: boolean;
  /** 채팅 모드에 주입할 "지금 나는 어디에서 무엇을 하는 중" 블록 */
  lifeContext?: string;
  /** 자다 깨서 몰아 답하거나 여행 중이라 늦은 경우의 한 줄 지침 */
  deliveryNote?: string;
  /** 이번 턴에만 적용되는 추가 지침 (따라 쓰기 성공 칭찬, 사진 반응 등) */
  turnNotes?: string[];
}

/** Encodes untrusted profile, memory, transcript, and model text inside prompt data blocks. */
export function escapePromptData(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapePromptVars(vars: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(vars).map(([key, value]) => [key, escapePromptData(value)]));
}

export function baseVars(tutorId: string, externalConversation = false): Record<string, string> {
  const p = getPersona(tutorId);
  if (externalConversation) {
    const intimacy = 1;
    return escapePromptVars({
      name: p.name,
      age: String(p.age),
      job: p.job,
      nationality: p.nationality,
      personality: p.personality,
      speakingStyle: p.speakingStyle,
      interests: p.interests.join(", "),
      learnerName: "(아직 이름을 모름)",
      level: "2",
      intimacy: String(intimacy),
      intimacyTone: p.toneByIntimacy[String(intimacy)] ?? p.toneByIntimacy["1"],
      intimacyTopics: (p.topicsByIntimacy[String(intimacy)] ?? []).join(", "),
      memory: "(아직 없음)",
    });
  }

  const user = getUser();
  const ts = getTutorState(tutorId);
  const intimacy = intimacyLevel(ts.intimacyXp);
  return escapePromptVars({
    name: p.name,
    age: String(p.age),
    job: p.job,
    nationality: p.nationality,
    personality: p.personality,
    speakingStyle: p.speakingStyle,
    interests: p.interests.join(", "),
    learnerName: user.name || "(아직 이름을 모름 — 물어보세요)",
    level: String(user.level),
    intimacy: String(intimacy),
    intimacyTone: p.toneByIntimacy[String(intimacy)] ?? p.toneByIntimacy["1"],
    intimacyTopics: (p.topicsByIntimacy[String(intimacy)] ?? []).join(", "),
    memory: formatMemory(tutorId),
  });
}

function buildTurnContract(session: SessionRecord, context: TurnPromptContext): string {
  const recentTutorReplies = session.turns
    .filter((turn) => turn.role === "tutor")
    .slice(-5)
    .map((turn, index) => `${index + 1}. ${escapePromptData(turn.text)}`)
    .join("\n");
  const userTurns = session.turns.filter((turn) => turn.role === "user").length;

  return loadPrompt("turn-contract", {
    currentUserText: context.isGreeting ? "(학습자는 아직 말하지 않았음)" : escapePromptData(context.userText),
    turnKind: context.isGreeting ? "통화 연결 직후 첫 인사" : "학습자의 실제 발화에 답하는 턴",
    userTurnNumber: String(userTurns + (context.isGreeting ? 0 : 1)),
    recentTutorReplies: recentTutorReplies || "(이전 튜터 발화 없음)",
    retryReason: context.retryReason ? escapePromptData(context.retryReason) : "(없음 — 첫 생성)",
  });
}

export function buildSystemPrompt(
  session: SessionRecord,
  judgment?: Judgment,
  context: TurnPromptContext = { userText: "" },
): string {
  const vars = baseVars(session.tutorId, context.externalConversation === true);
  const base = loadPrompt("tutor-base", vars);
  const correction = loadPrompt("correction-engine");
  const level = Number(vars.level) || 2;
  const levelPolicy = getLevelPolicy(level, session.mode);
  const correctionAllowed = correctionAllowedForTurn(session, level);
  const levelAdaptation = loadPrompt("level-adaptation", {
    level: String(levelPolicy.level),
    maxSentences: String(levelPolicy.maxSentences),
    replyWordBudget: levelPolicy.replyWordBudget,
    vocabulary: levelPolicy.vocabulary,
    question: levelPolicy.question,
    correction: levelPolicy.correction,
    repetition: levelPolicy.repetition,
    correctionStatus: correctionAllowed
      ? "허용 — 가치 있는 오류가 있을 때만 1개"
      : `보류 — 최근 교정 후 최소 ${levelPolicy.correctionCadence}개 학습자 턴 간격이 아직 지나지 않음`,
  });
  const turnContract = buildTurnContract(session, context);
  const isolatedContext = context.externalConversation ? loadPrompt("external-conversation") : "";
  const joinSections = (...sections: string[]) => sections.filter(Boolean).join("\n\n---\n\n");

  if (session.mode === "chat") {
    const notes = (context.turnNotes ?? []).filter(Boolean);
    const chatMode = loadPrompt("chat-mode", {
      lifeContext: escapePromptData(context.lifeContext ?? "특별한 일 없이 평소대로 지내는 중입니다."),
      deliveryNote: context.deliveryNote ? `## 답장이 늦은 이유\n${escapePromptData(context.deliveryNote)}` : "",
      turnNotes: notes.length > 0
        ? `## 이번 턴 참고\n${notes.map((note) => `- ${escapePromptData(note)}`).join("\n")}`
        : "",
    });
    return joinSections(base, correction, levelAdaptation, chatMode, isolatedContext, turnContract);
  }

  if (session.mode === "learning" && session.unitId && session.stageState) {
    const unit = getUnit(session.unitId);
    const st = session.stageState;
    const expressionList = unit.expressions.map((e) => `- ${e.id} | ${e.en} | ${e.ko}`).join("\n");
    const reviewList =
      st.reviewItems.length > 0
        ? st.reviewItems.map((r) => `${r.expressionId} | ${r.en} | ${r.ko}${r.result ? ` (완료:${r.result})` : ""}`).join(" / ")
        : "(없음)";
    const judgmentNote = judgment
      ? `학습자가 방금 "${judgment.target}" 를 따라 말했고 발음/유사도 점수는 ${judgment.score}점(${judgment.pass ? "통과" : "미통과"})입니다. ${judgment.pass ? "구체적으로 칭찬하고 다음으로 진행하세요." : "격려하며 다시 한번 천천히 따라 말하게 하세요. suggestion에 같은 문장을 다시 넣으세요."}`
      : "(이번 턴은 따라 말하기 판정이 아닙니다)";
    const conductor = loadPrompt("learning-conductor", {
      unitTitle: unit.title,
      unitTitleKo: unit.titleKo,
      unitTopic: unit.topic,
      expressionList,
      stage: st.stage,
      reviewList,
      introIndex: String(st.introIndex),
      practicedList: st.practicedIds.join(", ") || "(없음)",
      situationSetting: unit.situation.setting,
      situationTutorRole: unit.situation.tutorRole,
      situationLearnerRole: unit.situation.learnerRole,
      situationGoal: unit.situation.goalKo,
      roleplayUsedList: st.roleplayUsedIds.join(", ") || "(없음)",
      turnsInStage: String(st.turnsInStage),
      judgmentNote,
    });
    return joinSections(base, correction, levelAdaptation, conductor, isolatedContext, turnContract);
  }

  // freetalk (+ 선택된 시나리오 롤플레이)
  let scenarioBlock = "";
  if (session.scenarioId) {
    const sc = getScenario(session.scenarioId);
    if (sc) {
      scenarioBlock = loadPrompt("scenario-block", {
        scenarioTitle: `${sc.title} (${sc.titleKo})`,
        scenarioDesc: sc.descriptionKo,
        tutorRole: sc.tutorRole,
        learnerRole: sc.learnerRole,
        scenarioGoal: sc.goalKo,
        scenarioFlow: sc.conversationFlow.map((step, index) => `${index + 1}. ${step}`).join("\n"),
        scenarioOpening: sc.openingLine,
        scenarioOpeningTurn: session.turns.some((turn) => turn.role === "tutor") ? "아니요" : "예",
        // 2턴 연속 상황을 벗어나면 잠깐 역할을 벗고 한국어 힌트를 준 뒤 복귀한다.
        recoveryHint: (() => {
          const hint = recoveryHint(offTopicStreak(session.turns, sc), sc);
          return hint ? `## 복구 지침 (이번 턴 한정)\n${hint}` : "";
        })(),
      });
    }
  }
  const freetalk = loadPrompt("freetalk", { scenarioBlock });
  return joinSections(base, correction, levelAdaptation, freetalk, isolatedContext, turnContract);
}
