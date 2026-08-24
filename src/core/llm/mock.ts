// 목(mock) LLM — API 키 없이 전체 앱 흐름을 시연/테스트하기 위한 어댑터.
// 실제 대화 품질은 없고, JSON 계약과 단계 진행만 그럴듯하게 흉내낸다.

import type { LLMMessage, LLMResult } from "./index";

const ERROR_TABLE: { pattern: RegExp; better: (m: string) => string; reason: string; type: string }[] = [
  { pattern: /\bi am agree\b/i, better: (m) => m.replace(/i am agree/i, "I agree"), reason: "agree는 동사라서 be동사가 필요 없어요", type: "grammar" },
  { pattern: /\byesterday i go\b/i, better: (m) => m.replace(/yesterday i go/i, "Yesterday I went"), reason: "과거 일이니까 went를 써요", type: "tense" },
  { pattern: /\bdifferent with\b/i, better: (m) => m.replace(/different with/i, "different from"), reason: "different는 from과 함께 써요", type: "preposition" },
  { pattern: /\bhand phone\b/i, better: (m) => m.replace(/hand phone/i, "cell phone"), reason: "'핸드폰'은 콩글리시! 원어민은 cell phone이라고 해요", type: "konglish" },
  { pattern: /\blisten music\b/i, better: (m) => m.replace(/listen music/i, "listen to music"), reason: "listen은 to와 함께 써요", type: "preposition" },
];

function detectCorrection(text: string) {
  for (const e of ERROR_TABLE) {
    if (e.pattern.test(text)) {
      return { original: text, better: e.better(text), ko: "(교정 문장)", reason: e.reason, type: e.type };
    }
  }
  return null;
}

function parseExpressions(system: string): { id: string; en: string; ko: string }[] {
  // learning-conductor의 expressionList 형식: "- u1e1 | I'm from Korea. | 저는 한국에서 왔어요."
  const out: { id: string; en: string; ko: string }[] = [];
  for (const line of system.split("\n")) {
    const m = line.match(/^- (u\d+e\d+) \| (.+?) \| (.+)$/);
    if (m) out.push({ id: m[1], en: m[2], ko: m[3] });
  }
  return out;
}

const FREETALK_REPLIES = [
  "Oh really? That sounds interesting! Tell me more about it.",
  "No way! I totally get that. What happened next?",
  "That's so cool! How did you feel about it?",
  "Haha, I love that. By the way, what are you up to this weekend?",
  "Interesting! You know, something similar happened to me. Anyway, what do you think about it?",
];

const CHAT_REPLIES = [
  "omg really? 😄 tell me more!",
  "haha nice! what are you doing today?",
  "that sounds fun! I just finished work. so tired lol",
  "wait, seriously? I need details 😆",
];

let counter = 0;

export async function chatMock(opts: {
  system: string;
  messages: LLMMessage[];
  maxTokens?: number;
  feature: string;
}): Promise<LLMResult> {
  counter++;
  const { system } = opts;
  const lastUser = [...opts.messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const usage = { inputTokens: 0, outputTokens: 0 };
  const json = (obj: unknown): LLMResult => ({ text: JSON.stringify(obj), usage });

  // ── 특수 프롬프트 분기 ──
  if (system.includes("능동 메시지 생성")) {
    const type = system.match(/메시지 종류: (\w+)/)?.[1] ?? "morning";
    const byType: Record<string, { text: string; ko: string }> = {
      morning: { text: "Good morning! ☀️ How's your day starting?", ko: "좋은 아침! ☀️ 오늘 하루 어떻게 시작하고 있어?" },
      quiz: { text: "Quick question! Friday night: big party, or pizza at home? 😏", ko: "돌발 질문! 금요일 밤: 파티야, 집에서 피자야? 😏" },
      checkin: { text: "Hey! How did that thing you mentioned go?", ko: "야! 저번에 말한 그 일은 어떻게 됐어?" },
      missyou: { text: "Heyyy, it's been a while! I miss our chats 🥲", ko: "야아, 오랜만이야! 우리 수다 그리워 🥲" },
    };
    return json(byType[type] ?? byType.morning);
  }
  if (system.includes("세션 요약")) {
    return json({ facts: [] });
  }
  if (system.includes("힌트 생성")) {
    const ko = system.split("학습자가 하고 싶은 말")[1]?.trim() ?? "";
    return json({
      primary: { en: `How do I say this in English? (${ko.slice(0, 20)})`, ko: "목 모드 힌트입니다" },
      natural: { en: "Could you help me say that in English?", ko: "그걸 영어로 어떻게 말하는지 도와줄래?" },
    });
  }
  if (system.includes("레벨 테스트")) {
    const words = lastUser.split(/\s+/).filter(Boolean).length;
    const level = Math.max(1, Math.min(4, Math.round(words / 25) + 1));
    return json({ level, note: "목 모드 평가입니다. 실제 평가는 API 키 연결 후 이용하세요." });
  }

  // ── 대화 턴 (freetalk / learning / chat) ──
  const correction = detectCorrection(lastUser);
  const base = {
    reply: "",
    reply_ko: "(목 모드 응답)",
    correction,
    suggestion: null as unknown,
    new_expression: null as string | null,
    used_expressions: [] as string[],
    stage_signal: "stay" as string,
    end_call: false,
  };

  const stageMatch = system.match(/현재 단계: (\w+)/);
  if (stageMatch) {
    const stage = stageMatch[1];
    const exprs = parseExpressions(system);
    const lower = lastUser.toLowerCase();
    const used = exprs.filter((e) => lower.includes(e.en.toLowerCase().replace(/[.?!]$/, "").slice(0, 12))).map((e) => e.id);
    base.used_expressions = used;

    if (stage === "review") {
      base.reply = "Let's warm up! Quick question: what did you do last weekend?";
      base.reply_ko = "몸풀기! 지난 주말에 뭐 했어?";
      if (opts.messages.length > 2) base.stage_signal = "advance";
    } else if (stage === "intro") {
      const introIndex = parseInt(system.match(/표현을 (\d+)번째까지 소개했습니다/)?.[1] ?? "0", 10);
      const next = exprs[introIndex];
      if (next) {
        base.reply = `Here's a useful one. Listen: "${next.en}" — try saying it with me!`;
        base.reply_ko = `유용한 표현이야. 들어봐: "${next.en}" — 같이 말해보자!`;
        base.new_expression = next.id;
        base.suggestion = { en: next.en, ko: next.ko };
        if (introIndex >= exprs.length - 1) base.stage_signal = "advance";
      } else {
        base.stage_signal = "advance";
        base.reply = "Great, you've got all of them!";
        base.reply_ko = "좋아, 표현을 다 배웠어!";
      }
    } else if (stage === "practice") {
      const target = exprs[counter % Math.max(1, exprs.length)];
      if (used.length > 0) {
        base.reply = "Yes! That was perfect. Let's try another one.";
        base.reply_ko = "좋아! 완벽했어. 다른 것도 해보자.";
      } else if (target) {
        base.reply = `Nice try! You could say it like this: "${target.en}". Your turn!`;
        base.reply_ko = `좋은 시도야! 이렇게 말해봐: "${target.en}". 네 차례!`;
        base.suggestion = { en: target.en, ko: target.ko };
      }
    } else if (stage === "roleplay") {
      base.reply = used.length > 0 ? "(role-play) Perfect, that's exactly what I needed to hear!" : "(role-play) Hello! How can I help you today?";
      base.reply_ko = "(상황극) 목 모드 진행 중";
    } else {
      base.reply = "That was an awesome session! Talk soon!";
      base.reply_ko = "오늘 정말 잘했어! 또 통화하자!";
      base.end_call = true;
    }
    return json(base);
  }

  if (system.includes("채팅 모드")) {
    base.reply = CHAT_REPLIES[counter % CHAT_REPLIES.length];
    base.reply_ko = "(목 모드) 채팅 응답";
    return json(base);
  }

  base.reply = FREETALK_REPLIES[counter % FREETALK_REPLIES.length];
  base.reply_ko = "(목 모드) 프리토킹 응답";
  return json(base);
}
