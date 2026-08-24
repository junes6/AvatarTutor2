// 모드별 시스템 프롬프트 조립 — 모든 내용은 /prompts/*.md 에서 온다.

import { loadPrompt } from "../prompts";
import { getPersona, getScenario, getUnit } from "../content";
import { getUser, getTutorState, intimacyLevel } from "../gamification";
import { formatMemory } from "../memory";
import type { SessionRecord, StageState, Judgment } from "../types";

export function baseVars(tutorId: string): Record<string, string> {
  const p = getPersona(tutorId);
  const user = getUser();
  const ts = getTutorState(tutorId);
  const intimacy = intimacyLevel(ts.intimacyXp);
  return {
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
  };
}

export function buildSystemPrompt(session: SessionRecord, judgment?: Judgment): string {
  const vars = baseVars(session.tutorId);
  const base = loadPrompt("tutor-base", vars);
  const correction = loadPrompt("correction-engine");

  if (session.mode === "chat") {
    return [base, correction, loadPrompt("chat-mode")].join("\n\n---\n\n");
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
      roleplayUsedList: st.roleplayUsedIds.join(", ") || "(없음)",
      judgmentNote,
    });
    return [base, correction, conductor].join("\n\n---\n\n");
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
      });
    }
  }
  const freetalk = loadPrompt("freetalk", { scenarioBlock });
  return [base, correction, freetalk].join("\n\n---\n\n");
}
