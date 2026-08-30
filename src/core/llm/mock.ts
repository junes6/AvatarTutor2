// 목(mock) LLM — API 키 없이도 대화 흐름을 실제로 점검할 수 있는 로컬 응답기.
// 고정 문구 순환 대신 최신 사용자 발화, 직전 질문, 페르소나, 시나리오와
// 러닝 단계 상태를 읽어 결정적으로 응답한다.

import type { LLMMessage, LLMResult } from "./index";
import { hasExplicitEndIntent } from "../pipeline/intent";

const ERROR_TABLE: { pattern: RegExp; better: (m: string) => string; reason: string; type: string }[] = [
  { pattern: /\bi am agree\b/i, better: (m) => m.replace(/i am agree/i, "I agree"), reason: "agree는 동사라서 be동사가 필요 없어요", type: "grammar" },
  { pattern: /\byesterday i go\b/i, better: (m) => m.replace(/yesterday i go/i, "Yesterday I went"), reason: "과거 일이니까 went를 써요", type: "tense" },
  { pattern: /\bdifferent with\b/i, better: (m) => m.replace(/different with/i, "different from"), reason: "different는 from과 함께 써요", type: "preposition" },
  { pattern: /\bhand phone\b/i, better: (m) => m.replace(/hand phone/i, "cell phone"), reason: "'핸드폰'은 콩글리시! 원어민은 cell phone이라고 해요", type: "konglish" },
  { pattern: /\blisten music\b/i, better: (m) => m.replace(/listen music/i, "listen to music"), reason: "listen은 to와 함께 써요", type: "preposition" },
];

function detectCorrection(text: string) {
  for (const error of ERROR_TABLE) {
    if (error.pattern.test(text)) {
      return { original: text, better: error.better(text), ko: "(교정 문장)", reason: error.reason, type: error.type };
    }
  }
  return null;
}

interface ParsedExpression {
  id: string;
  en: string;
  ko: string;
}

function parseExpressions(system: string): ParsedExpression[] {
  const out: ParsedExpression[] = [];
  for (const line of system.split("\n")) {
    const match = line.match(/^- (u\d+e\d+) \| (.+?) \| (.+)$/);
    if (match) out.push({ id: match[1], en: match[2], ko: match[3] });
  }
  return out;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lineValue(system: string, label: string): string {
  const match = system.match(new RegExp(`^- ${escapeRegExp(label)}:\\s*(.+)$`, "m"));
  return match?.[1]?.trim() ?? "";
}

function includesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function compactSnippet(text: string, maxWords = 9): string {
  const cleaned = text
    .replace(/\s+/g, " ")
    .replace(/["“”]/g, "'")
    .replace(/[?!.,]+$/g, "")
    .trim();
  const words = cleaned.split(" ").filter(Boolean);
  return words.slice(0, maxWords).join(" ") || "that";
}

function stripTerminalPunctuation(text: string): string {
  return text.replace(/[.?!]+$/g, "").trim();
}

function cleanOrderItem(text: string): string {
  return compactSnippet(text, 8)
    .replace(/^(?:can i (?:get|have)|i(?:'d| would) like|i want)\s+/i, "")
    .replace(/\s*,?\s*please$/i, "")
    .trim();
}

function sentenceCase(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9가-힣]+/g, " ").trim();
}

function isKoreanDominant(text: string): boolean {
  const korean = text.match(/[가-힣]/g)?.length ?? 0;
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0;
  return korean > 0 && korean >= latin;
}

function lastAssistantText(messages: LLMMessage[]): string {
  return [...messages].reverse().find((message) => message.role === "assistant")?.content ?? "";
}

function isNumberOnly(text: string): boolean {
  return /^(?:\d+(?:\.\d+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten|hundred|one hundred)[.!\s]*$/i.test(text.trim());
}

function signalsMissingOrUnavailable(text: string): boolean {
  return includesAny(text, [
    /\b(?:forgot|forget|left (?:it|that|my .+?)?(?:\s+at home)?|lost|misplaced|don'?t have|do not have|can'?t find|cannot find|didn'?t bring|did not bring|no passport)\b/i,
    /(?:깜빡|잊(?:었|어|었습니다)|안\s*(?:가져|챙겨)|없(?:어|어요|습니다)|잃(?:었|어)|분실)/,
  ]);
}

function isGreetingTurn(text: string): boolean {
  return text.includes("방금 영상통화가 연결되었습니다") || text.includes("학습자는 아직 아무 말도 하지 않았습니다");
}

function wantsToEnd(text: string): boolean {
  return hasExplicitEndIntent(text);
}

function mockHint(koreanInput: string) {
  const text = koreanInput.replace(/\s+/g, " ").trim().replace(/[.!?~]+$/g, "");
  const common: Array<{
    pattern: RegExp;
    primary: { en: string; ko: string };
    natural: { en: string; ko: string };
  }> = [
    { pattern: /^(?:안녕|안녕하세요)$/, primary: { en: "Hello.", ko: "안녕하세요." }, natural: { en: "Hi, nice to meet you.", ko: "안녕하세요, 만나서 반가워요." } },
    { pattern: /^(?:오늘\s*)?(?:너무|정말)?\s*피곤(?:해|해요|합니다)?$/, primary: { en: "I'm tired today.", ko: "오늘 피곤해요." }, natural: { en: "I'm pretty tired today.", ko: "오늘 꽤 피곤해요." } },
    { pattern: /^(?:잘\s*)?(?:모르겠어|모르겠어요|모릅니다)$/, primary: { en: "I'm not sure.", ko: "잘 모르겠어요." }, natural: { en: "I'm not quite sure about that.", ko: "그건 확실히 잘 모르겠어요." } },
    { pattern: /^(?:다시|한\s*번\s*더).*(?:말|얘기).*(?:줘|주세요|해줘|해\s*주세요)?$/, primary: { en: "Could you say that again?", ko: "다시 말해 주시겠어요?" }, natural: { en: "Could you say that one more time?", ko: "한 번만 더 말해 주시겠어요?" } },
    { pattern: /^천천히.*(?:말|얘기).*(?:줘|주세요|해줘|해\s*주세요)?$/, primary: { en: "Could you speak more slowly?", ko: "조금 더 천천히 말해 주시겠어요?" }, natural: { en: "Could you slow down a little?", ko: "조금만 천천히 말해 주실래요?" } },
    { pattern: /^(?:도와줄래|도와주세요|도와\s*줄\s*수\s*있어(?:요)?)$/, primary: { en: "Could you help me?", ko: "도와주실 수 있나요?" }, natural: { en: "Could you give me a hand?", ko: "저 좀 도와주실래요?" } },
    { pattern: /^화장실(?:은|이)?\s*어디(?:예요|에요|야|입니까)?$/, primary: { en: "Where is the restroom?", ko: "화장실이 어디예요?" }, natural: { en: "Could you tell me where the restroom is?", ko: "화장실이 어디인지 알려주시겠어요?" } },
    { pattern: /^(?:이거|이것|그거|그것)(?:은|이)?\s*얼마(?:예요|에요|입니까)?$/, primary: { en: "How much is this?", ko: "이거 얼마예요?" }, natural: { en: "How much does this cost?", ko: "이건 가격이 얼마인가요?" } },
    { pattern: /^(?:뭐|무엇)(?:을|를)?\s*추천(?:해|해요|하세요|하시나요)?$/, primary: { en: "What do you recommend?", ko: "무엇을 추천하세요?" }, natural: { en: "What would you recommend?", ko: "어떤 걸 추천해 주시겠어요?" } },
    // 카페
    { pattern: /^(?:아이스\s*)?(?:라테|라떼)\s*(?:한\s*잔|하나)?\s*(?:주세요|주실래요|부탁해요)?$/, primary: { en: "Can I get an iced latte, please?", ko: "아이스 라테 한 잔 주세요." }, natural: { en: "I'd like an iced latte, please.", ko: "아이스 라테 한 잔 부탁드려요." } },
    { pattern: /^(?:아이스\s*)?아메리카노\s*(?:한\s*잔|하나)?\s*(?:주세요|주실래요|부탁해요)?$/, primary: { en: "Can I get an iced Americano, please?", ko: "아이스 아메리카노 한 잔 주세요." }, natural: { en: "I'd like an iced Americano, please.", ko: "아이스 아메리카노 한 잔 부탁드려요." } },
    // 공항
    { pattern: /^(?:비행기\s*)?체크인(?:을\s*)?(?:하고\s*싶어요|하려고요|할게요)$/, primary: { en: "I'd like to check in.", ko: "체크인하고 싶어요." }, natural: { en: "Hi, I'd like to check in for my flight.", ko: "안녕하세요, 비행기 체크인을 하고 싶어요." } },
    { pattern: /^(?:제가\s*)?(?:비행기|항공편)(?:를|을)?\s*(?:놓칠|못\s*탈)\s*것\s*같(?:아요|습니다)$/, primary: { en: "I think I'm going to miss my flight.", ko: "비행기를 놓칠 것 같아요." }, natural: { en: "I'm worried I might miss my flight.", ko: "비행기를 놓칠까 봐 걱정돼요." } },
    { pattern: /^(?:제\s*)?(?:비행기|항공편)(?:가|이)?\s*(?:지연됐어요|지연되었습니다|늦어졌어요)$/, primary: { en: "My flight has been delayed.", ko: "제 비행기가 지연됐어요." }, natural: { en: "It looks like my flight has been delayed.", ko: "제 비행기가 지연된 것 같아요." } },
    { pattern: /^(?:제\s*)?(?:탑승구|게이트)(?:가|는|은)?\s*어디(?:예요|에요|입니까)?$/, primary: { en: "Where is my gate?", ko: "제 탑승구가 어디예요?" }, natural: { en: "Could you tell me where my departure gate is?", ko: "출발 탑승구가 어디인지 알려주시겠어요?" } },
    { pattern: /^(?:환승은|환승을\s*하려면)\s*(?:어디로\s*)?(?:가야\s*해요|가면\s*돼요)$/, primary: { en: "Where should I go for my connection?", ko: "환승하려면 어디로 가야 해요?" }, natural: { en: "Could you tell me where I need to go for my connecting flight?", ko: "연결 항공편을 타려면 어디로 가야 하는지 알려주시겠어요?" } },
    { pattern: /^(?:죄송(?:해요|합니다)?[, ]*)?(?:제가\s*)?여권(?:을|이)?\s*(?:깜빡(?:했어요|했습니다)?|잊(?:었어요|어버렸어요|었습니다)|안\s*(?:가져왔어요|챙겼어요)|가져오지\s*않았어요|분실(?:했어요|했습니다)|잃어버렸어요)$/, primary: { en: "I'm sorry, I forgot my passport.", ko: "죄송하지만 여권을 깜빡했어요." }, natural: { en: "I'm afraid I don't have my passport with me.", ko: "죄송하지만 지금 여권을 가지고 있지 않아요." } },
    { pattern: /^(?:제\s*)?여권(?:은|이)?\s*(?:여기\s*)?(?:있어요|있습니다|여기요)$/, primary: { en: "Here's my passport.", ko: "제 여권 여기 있습니다." }, natural: { en: "Of course. Here's my passport.", ko: "물론이죠. 제 여권 여기 있습니다." } },
    { pattern: /^(?:저는\s*)?도쿄(?:로|에)\s*(?:가요|갑니다|갈\s*거예요)$/, primary: { en: "I'm flying to Tokyo.", ko: "도쿄로 가요." }, natural: { en: "My destination is Tokyo.", ko: "제 목적지는 도쿄입니다." } },
    { pattern: /^(?:저는\s*)?오사카(?:로|에)\s*(?:가요|갑니다|갈\s*거예요)$/, primary: { en: "I'm flying to Osaka.", ko: "오사카로 가요." }, natural: { en: "My destination is Osaka.", ko: "제 목적지는 오사카입니다." } },
    { pattern: /^(?:저는\s*)?뉴욕(?:으로|에)\s*(?:가요|갑니다|갈\s*거예요)$/, primary: { en: "I'm flying to New York.", ko: "뉴욕으로 가요." }, natural: { en: "My destination is New York.", ko: "제 목적지는 뉴욕입니다." } },
    { pattern: /^(?:저는\s*)?런던(?:으로|에)\s*(?:가요|갑니다|갈\s*거예요)$/, primary: { en: "I'm flying to London.", ko: "런던으로 가요." }, natural: { en: "My destination is London.", ko: "제 목적지는 런던입니다." } },
    { pattern: /^(?:저는\s*)?파리(?:로|에)\s*(?:가요|갑니다|갈\s*거예요)$/, primary: { en: "I'm flying to Paris.", ko: "파리로 가요." }, natural: { en: "My destination is Paris.", ko: "제 목적지는 파리입니다." } },
    { pattern: /^(?:저는\s*)?제주(?:로|에)\s*(?:가요|갑니다|갈\s*거예요)$/, primary: { en: "I'm flying to Jeju.", ko: "제주로 가요." }, natural: { en: "My destination is Jeju.", ko: "제 목적지는 제주입니다." } },
    { pattern: /^(?:부칠\s*)?(?:가방|수하물)(?:은|이)?\s*(?:한|1)\s*(?:개)?(?:예요|에요|입니다|있어요)$/, primary: { en: "I have one bag to check.", ko: "부칠 가방이 한 개 있어요." }, natural: { en: "I'd like to check one bag.", ko: "가방 한 개를 부치고 싶어요." } },
    { pattern: /^(?:부칠\s*)?(?:가방|수하물)(?:은|이)?\s*(?:두|2)\s*(?:개)?(?:예요|에요|입니다|있어요)$/, primary: { en: "I have two bags to check.", ko: "부칠 가방이 두 개 있어요." }, natural: { en: "I'd like to check two bags.", ko: "가방 두 개를 부치고 싶어요." } },
    { pattern: /^창가\s*(?:자리|좌석)(?:로|를)?\s*(?:주세요|부탁(?:드려요|해요))$/, primary: { en: "Could I have a window seat?", ko: "창가 자리로 주시겠어요?" }, natural: { en: "Could I get a window seat, if possible?", ko: "가능하면 창가 자리로 부탁드려요." } },
    // 호텔
    { pattern: /^(?:호텔에\s*)?(?:예약한\s*방에\s*)?체크인(?:을\s*)?(?:하고\s*싶어요|하려고요|할게요)$/, primary: { en: "I'd like to check in.", ko: "체크인하고 싶어요." }, natural: { en: "Hi, I have a reservation and I'd like to check in.", ko: "안녕하세요, 예약했는데 체크인하고 싶어요." } },
    { pattern: /^(?:와이파이|wifi)\s*(?:비밀번호|비번)(?:가|은)?\s*(?:뭐예요|무엇인가요|알려주세요)$/, primary: { en: "What is the Wi-Fi password?", ko: "와이파이 비밀번호가 뭐예요?" }, natural: { en: "Could you tell me the Wi-Fi password?", ko: "와이파이 비밀번호를 알려주시겠어요?" } },
    // 레스토랑
    { pattern: /^(?:메뉴|메뉴판)(?:을|좀)?\s*(?:주세요|보여주세요)$/, primary: { en: "Could I see the menu, please?", ko: "메뉴를 보여주시겠어요?" }, natural: { en: "May I have a look at the menu, please?", ko: "메뉴를 좀 볼 수 있을까요?" } },
    { pattern: /^(?:이제\s*)?주문(?:할게요|하겠습니다|하고\s*싶어요)$/, primary: { en: "I'd like to order now.", ko: "이제 주문할게요." }, natural: { en: "We're ready to order.", ko: "저희 주문할 준비됐어요." } },
    // 면접
    { pattern: /^제\s*장점은\s*책임감이\s*(?:강한|있다는)\s*것(?:이에요|입니다)$/, primary: { en: "My strength is that I'm responsible.", ko: "제 장점은 책임감이 강하다는 것입니다." }, natural: { en: "One of my strengths is my strong sense of responsibility.", ko: "제 강점 중 하나는 강한 책임감입니다." } },
    { pattern: /^(?:면접에서\s*)?(?:만나서|뵙게\s*되어)\s*반갑습니다$/, primary: { en: "It's nice to meet you.", ko: "만나서 반갑습니다." }, natural: { en: "Thank you for meeting with me today.", ko: "오늘 면접 기회를 주셔서 감사합니다." } },
    // 데이트·친교
    { pattern: /^주말에\s*(?:뭐|무엇을)\s*하는\s*걸\s*좋아(?:해요|하세요)$/, primary: { en: "What do you like to do on weekends?", ko: "주말에 뭐 하는 걸 좋아해요?" }, natural: { en: "How do you usually spend your weekends?", ko: "보통 주말을 어떻게 보내세요?" } },
    // 병원
    { pattern: /^어제부터\s*머리가\s*(?:아파요|아픕니다)$/, primary: { en: "I've had a headache since yesterday.", ko: "어제부터 머리가 아파요." }, natural: { en: "My head has been hurting since yesterday.", ko: "어제부터 계속 머리가 아파요." } },
    { pattern: /^머리가\s*(?:아파요|아픕니다)$/, primary: { en: "I have a headache.", ko: "머리가 아파요." }, natural: { en: "My head really hurts.", ko: "머리가 많이 아파요." } },
    { pattern: /^어제부터\s*배가\s*(?:아파요|아픕니다)$/, primary: { en: "I've had a stomachache since yesterday.", ko: "어제부터 배가 아파요." }, natural: { en: "My stomach has been hurting since yesterday.", ko: "어제부터 계속 배가 아파요." } },
    { pattern: /^배가\s*(?:아파요|아픕니다)$/, primary: { en: "I have a stomachache.", ko: "배가 아파요." }, natural: { en: "My stomach really hurts.", ko: "배가 많이 아파요." } },
    // 쇼핑
    { pattern: /^(?:이거|이것)(?:을|도)?\s*입어\s*봐도\s*(?:돼요|될까요|되나요)$/, primary: { en: "Can I try this on?", ko: "이거 입어봐도 될까요?" }, natural: { en: "Could I try this on, please?", ko: "이거 입어봐도 될까요?" } },
    { pattern: /^(?:더\s*)?큰\s*사이즈(?:가|는)?\s*(?:있나요|있어요)$/, primary: { en: "Do you have a larger size?", ko: "더 큰 사이즈가 있나요?" }, natural: { en: "Do you happen to have this in a larger size?", ko: "혹시 이거 더 큰 사이즈도 있나요?" } },
  ];
  const found = common.find((entry) => entry.pattern.test(text));
  if (found) return { primary: found.primary, natural: found.natural };
  return {
    unavailable: true,
    message: "지금은 이 문장을 정확한 영어로 바꿀 수 없어요. AI 번역 연결 후 다시 시도해 주세요.",
  };
}

function mockCoachingCard(koreanInput: string) {
  const hint = mockHint(koreanInput);
  if (!("primary" in hint) || !hint.primary) {
    return {
      primary: { en: "Sorry, I couldn't put that into English yet.", ko: "아직 이 문장을 영어로 바꾸지 못했어요." },
      variants: [],
      tip: "목(mock) 모드라 표현 데이터가 제한적이에요. API 키를 연결하면 실제 코칭 카드가 만들어집니다.",
    };
  }
  // 캐주얼 변형은 실제로 달라질 때만 넣는다 — 같은 문장을 두 번 보여주면 카드가 거짓말을 한다.
  const casual = hint.primary.en
    .replace(/,?\s*please\b/i, "")
    .replace(/^could you\b/i, "Can you")
    .replace(/^I'd like to\b/i, "I wanna")
    .replace(/^I'd like\b/i, "I want")
    .trim();
  const variants: { style: "casual" | "polite"; en: string; ko: string }[] = [
    { style: "polite", en: hint.natural.en, ko: hint.natural.ko },
  ];
  if (casual && casual.toLowerCase() !== hint.primary.en.toLowerCase()) {
    variants.unshift({ style: "casual", en: casual, ko: hint.primary.ko });
  }
  return {
    primary: hint.primary,
    variants,
    tip: "목(mock) 모드 예시입니다. API 키를 연결하면 상황에 맞춘 표현이 나옵니다.",
  };
}

interface MockOutput {
  reply: string;
  reply_ko: string;
  correction: ReturnType<typeof detectCorrection>;
  suggestion: { en: string; ko: string } | null;
  new_expression: string | null;
  used_expressions: string[];
  stage_signal: "stay" | "advance";
  end_call: boolean;
}

function makeBase(lastUser: string): MockOutput {
  return {
    reply: "",
    reply_ko: "",
    correction: detectCorrection(lastUser),
    suggestion: null,
    new_expression: null,
    used_expressions: [],
    stage_signal: "stay",
    end_call: false,
  };
}

function personaId(system: string): "mia" | "oliver" | "jack" {
  const name = lineValue(system, "이름").toLowerCase();
  if (name.includes("oliver")) return "oliver";
  if (name.includes("jack")) return "jack";
  return "mia";
}

function learnerLevel(system: string): number {
  const raw = lineValue(system, "영어 레벨");
  const parsed = Number(raw.match(/[1-5]/)?.[0] ?? 3);
  return Math.max(1, Math.min(5, parsed));
}

function adaptFreeTalkForLevel(
  system: string,
  lastUser: string,
  response: { reply: string; ko: string },
): { reply: string; ko: string } {
  const level = learnerLevel(system);
  if (level >= 3) return response;
  const id = personaId(system);

  if (level === 2) {
    return {
      ...response,
      reply: response.reply
        .replace(/wonderfully absorbing/gi, "really interesting")
        .replace(/Which detail would you like to unpack first\?/gi, "Which part do you want to talk about first?")
        .replace(/What led you to that view\?/gi, "Why do you think that?")
        .replace(/Fair dinkum,\s*/gi, "I get it—"),
    };
  }

  if (/^\s*(?:hi|hello|hey|good\s+(?:morning|afternoon|evening))/i.test(lastUser)) {
    if (id === "oliver") return { reply: "Hello. It is nice to hear from you. Is your day going well?", ko: "안녕하세요. 연락해서 반가워요. 오늘 하루 잘 보내고 있나요?" };
    if (id === "jack") return { reply: "Hi, mate! Good to see you. Are you feeling good today?", ko: "안녕, 친구! 만나서 반가워. 오늘 기분 좋아?" };
    return { reply: "Hi! I am happy to see you. Are you having a good day?", ko: "안녕! 만나서 반가워. 오늘 좋은 하루 보내고 있어?" };
  }

  if (/(?:\b(?:normal|ordinary|usual|nothing special|same as usual|pretty quiet)\b.*\b(?:day|today)\b|평범한\s*하루|별일\s*없)/i.test(lastUser)) {
    return { reply: "I understand. A normal day can be nice. Was it relaxing or boring?", ko: "알겠어. 평범한 하루도 좋을 수 있어. 편안했어, 아니면 지루했어?" };
  }

  const interest = lastUser.match(/^\s*i\s+(?:really\s+)?(?:like|love|enjoy)\s+(.+?)[.!]*\s*$/i)?.[1];
  if (interest) {
    const topic = compactSnippet(interest, 3);
    return { reply: `${sentenceCase(topic)} sounds fun. Do you do it often?`, ko: `${topic} 재미있겠다. 자주 해?` };
  }

  if (includesAny(lastUser, [/\b(?:tired|exhausted|sleepy|busy)\b/i, /피곤|지쳤|바빴/])) {
    return { reply: "That sounds hard. Do you want to rest now?", ko: "힘들었겠다. 지금 좀 쉬고 싶어?" };
  }
  if (includesAny(lastUser, [/\b(?:happy|excited|great day|good news)\b/i, /행복|신나|기뻐|좋은 일/])) {
    return { reply: "That is great! Did a person or an event make you happy?", ko: "정말 잘됐다! 사람 때문에 행복했어, 아니면 어떤 일 때문이야?" };
  }
  if (includesAny(lastUser, [/\b(?:worried|nervous|sad|upset|stressed)\b/i, /걱정|긴장|슬퍼|속상|스트레스/])) {
    return { reply: "I am sorry. Do you want to talk or take a break?", ko: "속상하겠다. 이야기하고 싶어, 아니면 잠깐 쉬고 싶어?" };
  }

  // 질문에 대한 페르소나 답변은 내용 보존이 더 중요하므로 이미 생성한 답을 쓴다.
  if (/\?/.test(lastUser)) return response;
  const snippet = compactSnippet(lastUser, 4);
  return {
    reply: `I hear you: "${snippet}." Was that good or difficult?`,
    ko: `“${snippet}”라고 한 말 이해했어. 그건 좋았어, 아니면 어려웠어?`,
  };
}

function personaGreeting(id: ReturnType<typeof personaId>): { reply: string; ko: string } {
  if (id === "oliver") return { reply: "Hello, lovely to meet you. How has your day been so far?", ko: "안녕하세요, 만나서 반가워요. 오늘 하루는 지금까지 어땠나요?" };
  if (id === "jack") return { reply: "G'day, mate! I'm Jack, and I'm glad you called. How are you feeling today?", ko: "안녕, 친구! 잭이야. 전화해줘서 반가워. 오늘 기분은 어때?" };
  return { reply: "Hi! I'm Mia, and I'm really happy to meet you. What should I call you?", ko: "안녕! 나는 미아야. 만나서 정말 반가워. 뭐라고 부르면 될까?" };
}

function personaAnswer(system: string, userText: string): { reply: string; ko: string } | null {
  const id = personaId(system);
  if (/\b(?:how are you|how is your day|how's your day)\b/i.test(userText)) {
    if (id === "oliver") return { reply: "Quite well, thanks. I finished work and made a very necessary coffee. How is your day treating you?", ko: "꽤 잘 지내, 고마워. 일을 마치고 꼭 필요했던 커피를 내렸어. 네 하루는 어때?" };
    if (id === "jack") return { reply: "I'm good, mate—I survived the brunch rush and still have energy left. How are you doing?", ko: "난 좋아, 친구. 브런치 러시도 살아남았고 아직 에너지도 남았어. 넌 어때?" };
    return { reply: "I'm good! I just wrapped up a class, so my brain is ready for a fun chat. How are you feeling?", ko: "난 좋아! 방금 수업이 끝나서 이제 즐겁게 수다 떨 준비됐어. 넌 기분이 어때?" };
  }
  if (/\b(?:where are you from|where do you live)\b/i.test(userText)) {
    if (id === "oliver") return { reply: "I'm from London, where talking about the rain is practically a hobby. Have you ever been to the UK?", ko: "나는 런던 출신이야. 거기서는 비 이야기가 거의 취미나 다름없지. 영국에 가본 적 있어?" };
    if (id === "jack") return { reply: "I'm from Sydney, close enough to the beach for an after-work surf. Do you like the ocean?", ko: "나는 시드니 출신이야. 퇴근 후 서핑할 만큼 바다와 가까워. 바다 좋아해?" };
    return { reply: "I'm from San Diego, so I grew up with sunshine and the beach. What is your hometown like?", ko: "나는 샌디에이고 출신이라 햇빛과 바다를 보며 자랐어. 네 고향은 어떤 곳이야?" };
  }
  if (/\b(?:what do you do|your job|do you work)\b/i.test(userText)) {
    if (id === "oliver") return { reply: "I work in marketing, mostly turning messy ideas into clear campaigns. What kind of work interests you?", ko: "나는 마케팅 일을 해. 복잡한 아이디어를 명확한 캠페인으로 만드는 일이 많아. 넌 어떤 일이 흥미로워?" };
    if (id === "jack") return { reply: "I'm a chef at a brunch restaurant, so mornings are wonderfully chaotic. What dish would you order at brunch?", ko: "나는 브런치 레스토랑 셰프라서 아침마다 신나게 정신없어. 브런치라면 어떤 메뉴를 주문할래?" };
    return { reply: "I'm studying psychology at university, and human behaviour fascinates me. What subject do you enjoy?", ko: "나는 대학에서 심리학을 공부하고 있고 사람의 행동이 정말 흥미로워. 넌 어떤 분야를 좋아해?" };
  }
  if (/\b(?:what (?:music|food|movie|sport).*(?:like|favorite)|what do you like|your favorite)\b/i.test(userText)) {
    if (id === "oliver") return { reply: "I'd choose strong coffee and a quiet jazz record—an excellent combination. What is your comfort favourite?", ko: "나는 진한 커피와 잔잔한 재즈 음반을 고를 거야. 아주 좋은 조합이지. 널 편안하게 해주는 최애는 뭐야?" };
    if (id === "jack") return { reply: "Food wins for me, especially anything cooked over a smoky barbecue. What food could you eat every week?", ko: "나는 역시 음식이야. 특히 훈연 향 나는 바비큐라면 최고지. 매주 먹어도 좋은 음식은 뭐야?" };
    return { reply: "K-pop is my weakness, and I also love finding tiny new cafés. Which song have you played most lately?", ko: "나는 K-pop에 약하고 작은 새 카페 찾는 것도 좋아해. 요즘 가장 많이 들은 노래는 뭐야?" };
  }
  const likeMatch = userText.match(/\bdo you like\s+(.+?)[?.!]*$/i);
  if (likeMatch) {
    const topic = compactSnippet(likeMatch[1], 5);
    return { reply: `I do enjoy ${topic}, especially when there is a good story behind it. What do you like about it?`, ko: `${topic} 좋아해. 특히 그 안에 좋은 이야기가 있을 때 더 좋아. 넌 어떤 점이 좋아?` };
  }
  if (/\b(?:what did you do today|what did you do this weekend|how was your weekend)\b/i.test(userText)) {
    if (id === "oliver") return { reply: "I browsed a little record shop and found an old jazz album. What was the best part of your weekend?", ko: "작은 음반 가게를 둘러보다 오래된 재즈 앨범을 찾았어. 네 주말에서 가장 좋았던 일은 뭐야?" };
    if (id === "jack") return { reply: "I tested a new chilli brunch sauce, and it nearly defeated me. What did you get up to?", ko: "새로운 매운 브런치 소스를 시험했는데 거의 나한테 이길 뻔했어. 넌 뭐 했어?" };
    return { reply: "I took Mochi for a long walk and then found a tiny café nearby. What did you do?", ko: "모치랑 오래 산책하고 근처의 작은 카페도 발견했어. 넌 뭐 했어?" };
  }
  return null;
}

function contextualFreeTalk(
  system: string,
  messages: LLMMessage[],
  lastUser: string,
  chatMode: boolean,
): { reply: string; ko: string } {
  const userMessages = messages.filter((message) => message.role === "user" && !isGreetingTurn(message.content));
  const turn = userMessages.length + (system.includes("거절된 이전 후보") ? 1 : 0);
  const previousUser = userMessages.length > 1 ? userMessages[userMessages.length - 2].content : "";
  const snippet = compactSnippet(lastUser, chatMode ? 6 : 9);
  const id = personaId(system);

  if (previousUser && normalizeForMatch(previousUser) === normalizeForMatch(lastUser)) {
    return { reply: `I heard you clearly—the '${snippet}' part came through. Let me ask more simply: why is that important to you?`, ko: "이번에는 분명히 들었어. 그게 너에게 왜 중요한지 더 쉽게 물어볼게." };
  }

  if (/^\s*(?:hi|hello|hey|good\s+(?:morning|afternoon|evening))(?:[, ]+(?:there|mia|oliver|jack))?[!.~]*\s*$/i.test(lastUser)) {
    if (id === "oliver") return { reply: "Hello—lovely to hear from you. How has your day been?", ko: "안녕하세요. 연락해서 반가워요. 오늘 하루는 어땠나요?" };
    if (id === "jack") return { reply: "G'day, mate! Good to see your message. What are you up to today?", ko: "안녕, 친구! 메시지 보니 반갑다. 오늘 뭐 하고 있어?" };
    return { reply: "Heyyy! I'm happy you messaged 😊 How are you doing today?", ko: "안녕! 메시지해줘서 반가워 😊 오늘 어떻게 지내?" };
  }

  if (/(?:\b(?:normal|ordinary|usual|nothing special|same as usual|pretty quiet)\b.*\b(?:day|today)\b|\b(?:day|today)\b.*\b(?:normal|ordinary|usual|nothing special|pretty quiet)\b|평범한\s*하루|별일\s*없)/i.test(lastUser)) {
    if (id === "oliver") return { reply: "A quiet, ordinary day can be rather nice, to be fair. Did one small thing make it pleasant?", ko: "솔직히 조용하고 평범한 하루도 꽤 좋죠. 소소하게 좋았던 일이 하나 있었나요?" };
    if (id === "jack") return { reply: "A cruisy day—no worries, those can be brilliant too. What was the best little bit?", ko: "느긋한 하루였네. 그런 날도 꽤 좋지. 소소하게 가장 좋았던 건 뭐야?" };
    return { reply: "Honestly, a normal day can feel cozy sometimes. Was there one tiny moment you liked?", ko: "평범한 하루도 가끔은 포근하게 느껴져. 마음에 든 작은 순간이 하나 있었어?" };
  }

  const interestMatch =
    lastUser.match(/^\s*i\s+(?:really\s+)?(?:like|love|enjoy)\s+(.+?)[.!]*\s*$/i) ??
    lastUser.match(/^\s*(?:my hobby is|i(?:'m| am) into)\s+(.+?)[.!]*\s*$/i);
  if (interestMatch) {
    const interest = compactSnippet(interestMatch[1], 6);
    if (id === "oliver") return { reply: `${sentenceCase(interest)} sounds wonderfully absorbing. What do you most enjoy creating?`, ko: `${interest}에 집중하는 시간이 참 좋겠네요. 어떤 걸 만드는 게 가장 즐거워요?` };
    if (id === "jack") return { reply: `Nice one, mate—${interest} takes a good eye and heaps of patience. What do you like to make?`, ko: `멋진 취미네, 친구. 좋은 눈과 인내심이 필요하잖아. 주로 뭘 만드는 걸 좋아해?` };
    return { reply: `Wait, ${interest} is such a cool hobby! What do you love drawing or making most?`, ko: `잠깐, ${interest} 정말 멋진 취미다! 뭘 그리거나 만드는 걸 가장 좋아해?` };
  }

  const directAnswer = personaAnswer(system, lastUser);
  if (directAnswer) return directAnswer;

  const nameMatch =
    lastUser.match(/\bmy name is\s+([a-z][a-z'-]{1,24}(?:\s+[a-z][a-z'-]{1,24})?)/i) ??
    lastUser.match(/^\s*(?:hi[,!]?\s+)?i(?:'m| am)\s+([A-Z][a-z'-]{1,24}(?:\s+[A-Z][a-z'-]{1,24})?)\s*[.!]?\s*$/) ??
    lastUser.match(/(?:나는|저는|제 이름은)\s*([가-힣]{2,8})(?:이야|입니다|예요)?/);
  if (nameMatch) {
    const name = nameMatch[1].trim();
    return chatMode
      ? { reply: `Nice to meet you, ${name} 😊 What are you up to today?`, ko: `${name}, 만나서 반가워 😊 오늘 뭐 하고 있어?` }
      : { reply: `Nice to meet you, ${name}. I'll remember that. What would you enjoy talking about today?`, ko: `${name}, 만나서 반가워. 이름 기억할게. 오늘은 어떤 이야기를 하고 싶어?` };
  }

  if (includesAny(lastUser, [/\b(?:tired|exhausted|sleepy|busy)\b/i, /피곤|지쳤|바빴/])) {
    const cause = lastUser.match(/\b(?:because(?: of)?|from|after)\s+(.+?)[.!?]*$/i)?.[1];
    if (cause) {
      const cleanCause = compactSnippet(cause, 6);
      const hasClause = /\b(?:am|is|are|was|were|felt|made|went|had|worked|studied|spent)\b/i.test(cleanCause);
      const acknowledgement = hasClause
        ? `It sounds like ${cleanCause}.`
        : `${cleanCause.charAt(0).toUpperCase()}${cleanCause.slice(1)} sounds exhausting.`;
      return { reply: chatMode ? `${acknowledgement} 😮‍💨 Which part drained you most?` : `${acknowledgement} Which part drained you most?`, ko: `그 일 때문에 지친 게 이해돼. 어떤 부분이 가장 힘들었어?` };
    }
    return { reply: chatMode ? "That sounds exhausting 😮‍💨 What took most of your energy?" : "You sound genuinely worn out. What took most of your energy?", ko: "정말 지쳤겠네. 뭐 때문에 에너지를 가장 많이 썼어?" };
  }
  if (includesAny(lastUser, [/\b(?:happy|excited|great day|good news)\b/i, /행복|신나|기뻐|좋은 일/])) {
    return { reply: chatMode ? "Okay, I can feel the excitement 😄 What made today so good?" : "I can hear how excited you are, and now I'm curious too. What made today feel so good?", ko: "신난 게 느껴져서 나도 궁금해졌어. 오늘 뭐가 그렇게 좋았어?" };
  }
  if (includesAny(lastUser, [/\b(?:worried|nervous)\b/i, /걱정|긴장/])) {
    return { reply: chatMode ? "That worry makes sense. Which part feels most uncertain right now?" : "That worry makes sense. Which part feels most uncertain right now?", ko: "그렇게 걱정될 만해. 지금 어떤 부분이 가장 불확실하게 느껴져?" };
  }
  if (includesAny(lastUser, [/\b(?:sad|upset|stressed)\b/i, /슬퍼|속상|스트레스/])) {
    return { reply: chatMode ? "I'm sorry—that sounds heavy. What has been weighing on you most?" : "I'm sorry you're carrying that; it sounds genuinely difficult. What has been weighing on you most?", ko: "그 마음을 안고 있다니 속상하다. 어떤 일이 가장 마음을 무겁게 해?" };
  }
  if (/\b(?:presentation|slide|meeting|pitch)\b/i.test(lastUser)) {
    if (/\b(?:forgot|missed|left out)\b/i.test(lastUser)) {
      return { reply: "Forgetting an important slide must have been stressful. How did you recover in the moment?", ko: "중요한 슬라이드를 빠뜨려서 당황했겠네. 그 순간에는 어떻게 수습했어?" };
    }
    if (/\b(?:badly|wrong|failed|terrible)\b/i.test(lastUser)) {
      return { reply: "That must have been frustrating after all your preparation. What went off track?", ko: "준비한 만큼 속상했겠네. 어떤 부분이 계획대로 되지 않았어?" };
    }
    return { reply: `I heard what you said about '${snippet}'. What would make the next one feel more manageable?`, ko: "발표나 회의 이야기를 잘 들었어. 다음번에는 무엇이 있으면 좀 더 수월할까?" };
  }
  if (includesAny(lastUser, [/\b(?:ate|food|restaurant|coffee|lunch|dinner|cook|barbecue|bbq)\b/i, /먹|음식|카페|커피|점심|저녁|요리|바비큐/])) {
    if (personaId(system) === "jack") return { reply: `Now you're speaking my language—'${snippet}' belongs near a hot grill. Which barbecue dish is your favourite?`, ko: "이제 내 전문 분야 얘기네. 그건 뜨거운 그릴 옆이 딱이지. 가장 좋아하는 바비큐 메뉴는 뭐야?" };
    return { reply: `The part about '${snippet}' made me hungry. What was the best flavour or dish?`, ko: `네가 말한 '${snippet}' 부분을 들으니 배고파지네. 어떤 맛이나 메뉴가 제일 좋았어?` };
  }
  if (includesAny(lastUser, [/\b(?:visited|trip|travel(?:led)?|vacation|busan|seoul|jeju)\b|\bwent\s+(?:to|on|away|abroad)\b/i, /여행|갔|다녀|부산|서울|제주/])) {
    return { reply: "That sounds like a real change of scenery. Which moment from the trip do you remember most clearly?", ko: "그곳에서 분위기를 제대로 바꾸고 왔겠네. 어떤 순간이 가장 선명하게 기억나?" };
  }
  if (includesAny(lastUser, [/\b(?:work|office|school|study|class|exam|project|presentation|meeting|slide)\b/i, /회사|일|학교|공부|수업|시험|프로젝트|발표|회의/])) {
    return { reply: `I heard the part about '${snippet}', and it sounds like it took some effort. What was the hardest part?`, ko: "네가 말한 부분이 꽤 힘이 들었을 것 같아. 뭐가 가장 어려웠어?" };
  }
  if (includesAny(lastUser, [/\b(?:song|music|concert|movie|drama|k-pop)\b/i, /노래|음악|콘서트|영화|드라마|케이팝/])) {
    return { reply: `I like that you brought up '${snippet}'. What did you enjoy most about it?`, ko: "그 이야기를 꺼낸 게 좋다. 어떤 점이 가장 마음에 들었어?" };
  }

  if (/\?/.test(lastUser)) {
    return { reply: `That's a thoughtful question about '${snippet}'. I don't want to guess without more context, so what made you wonder about it?`, ko: "그 부분에 대한 좋은 질문이야. 맥락 없이 추측하고 싶지 않은데, 왜 그게 궁금해졌어?" };
  }

  const variantsByPersona = {
    mia: [
      { reply: `Wait, the '${snippet}' part caught my attention. What made you think of it today?`, ko: "잠깐, 그 부분이 귀에 딱 들어왔어. 오늘 그 생각을 하게 된 이유가 뭐야?" },
      { reply: `I can totally picture what you mean by '${snippet}'. Which part matters most to you?`, ko: "무슨 뜻인지 장면이 그려져. 그중 어떤 부분이 너에게 가장 중요해?" },
    ],
    oliver: [
      { reply: `I see what you mean about '${snippet}'. Which detail would you like to unpack first?`, ko: "무슨 뜻인지 알겠어요. 어느 부분부터 조금 더 이야기해볼까요?" },
      { reply: `That's a thoughtful point about '${snippet}'. What led you to that view?`, ko: "그 부분에 대한 생각이 흥미롭네요. 어떻게 그런 생각을 하게 됐나요?" },
    ],
    jack: [
      { reply: `Got you, mate—the '${snippet}' bit stands out. What's the story behind it?`, ko: "알겠어, 친구. 그 부분이 눈에 띄네. 어떤 이야기가 숨어 있어?" },
      { reply: `Fair dinkum, '${snippet}' gives us something to work with. Which bit should we tackle first?`, ko: "좋아, 그 얘기면 이어갈 게 있네. 어느 부분부터 얘기해볼까?" },
    ],
  } satisfies Record<ReturnType<typeof personaId>, { reply: string; ko: string }[]>;
  const variants = variantsByPersona[id];
  return variants[turn % variants.length];
}

function scenarioOpening(system: string): { reply: string; ko: string } {
  const opening = system.match(/역할 대사 "([^"]+)"/)?.[1] ?? "Hello. How can I help you today?";
  const setting = lineValue(system, "장소/상황");
  const openingKoByScenario: Array<[RegExp, string]> = [
    [/\bcafe\b/i, "안녕하세요, 어서 오세요. 무엇을 준비해 드릴까요?"],
    [/\bairport\b/i, "좋은 아침입니다. 여권을 보여주시겠어요?"],
    [/\bhotel\b/i, "호텔에 오신 걸 환영합니다. 예약하셨나요?"],
    [/\brestaurant\b/i, "안녕하세요. 주문하시겠어요, 아니면 추천을 받아보시겠어요?"],
    [/\binterview\b/i, "오늘 와주셔서 감사합니다. 먼저 간단히 자기소개해 주시겠어요?"],
    [/\bdate\b/i, "안녕하세요, 만나서 정말 반가워요. 여기 찾아오기 쉬웠어요?"],
    [/\bhospital\b/i, "안녕하세요. 오늘 어디가 불편하세요?"],
    [/\bshopping\b/i, "안녕하세요! 무엇을 찾고 계신지 알려주시면 도와드릴게요."],
  ];
  const openingKo = openingKoByScenario.find(([pattern]) => pattern.test(setting))?.[1]
    ?? "안녕하세요. 오늘 무엇을 도와드릴까요?";
  return {
    reply: opening,
    ko: openingKo,
  };
}

interface ScenarioResponse {
  reply: string;
  ko: string;
  suggestion?: { en: string; ko: string } | null;
}

function cleanAirportDestination(text: string): string | null {
  const cleaned = text
    .replace(/^(?:i(?:'m| am)?\s*(?:flying|going|travelling|traveling)\s+to|my destination is|to)\s+/i, "")
    .replace(/\b(?:please|today)\b/gi, "")
    .replace(/[^A-Za-zÀ-ÖØ-öø-ÿ' -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned.length > 45 || cleaned.split(" ").length > 5) return null;
  if (/^(?:yes|no|okay|sorry|thanks?|unknown|nothing|one hundred|hundred)$/i.test(cleaned)) return null;
  return cleaned;
}

function airportScenarioResponse(messages: LLMMessage[], lastUser: string): ScenarioResponse {
  const previousTutor = lastAssistantText(messages).toLowerCase();
  const text = lastUser.trim();
  const lower = text.toLowerCase();
  const askedForAlternativeDocument = /another (?:travel document|photo id)|retrieve (?:it|your passport)|bring (?:it|your passport)/i.test(previousTutor);
  const askedForDestination = /which city|destination|where are you flying/i.test(previousTutor);
  const askedForPassport = /passport|travel document/i.test(previousTutor) && !askedForAlternativeDocument && !askedForDestination;
  const askedForBags = /how many bags|bags.*(?:check|checking)|checked bags/i.test(previousTutor);
  const askedForSeat = /window or an aisle|window or aisle|which seat/i.test(previousTutor);
  // Agreement is not the same physical action as presenting a document.
  // "Sure" / "of course" should keep us on the document step until the
  // learner actually says or gestures that they are handing it over.
  const passportProvided = /\b(?:here (?:it|you) (?:is|go)|here(?:'s| is) my passport|this is my passport|my passport is here|i (?:found|have|brought) (?:it|my passport))\b/i.test(lower);
  const yes = /^(?:yes|yeah|yep|i do|sure|of course|네|예|있어요)[.!\s]*$/i.test(text);
  const no = /^(?:no|nope|i don'?t|i do not|없어요|아니요)[.!\s]*$/i.test(text);

  if (/\b(?:miss|missing) (?:my |the )?flight\b|비행기.*놓칠|항공편.*놓칠/i.test(text)) {
    return {
      reply: "I understand you're worried about missing your flight. What time does boarding close?",
      ko: "비행기를 놓칠까 봐 걱정되시는군요. 탑승 마감 시간이 언제인가요?",
    };
  }

  // 누락·분실은 어느 단계에서 들어와도 완료로 간주하지 않는다. 특히 STT가
  // "sorry I'm I'm forgot forgot"처럼 목적어를 놓쳐도 직전 여권 질문으로 뜻을 복구한다.
  if (signalsMissingOrUnavailable(text) && (askedForPassport || /passport|여권/i.test(text) || /forgot|forget/i.test(text))) {
    return {
      reply: "I understand—you forgot your passport, so I can't complete check-in yet. Can you retrieve it?",
      ko: "여권을 잊으셨군요. 지금은 체크인을 완료할 수 없어요. 여권을 가져올 수 있나요?",
    };
  }

  if (askedForAlternativeDocument) {
    if (passportProvided) {
      return { reply: "Thank you, I can see your passport. Which city are you flying to today?", ko: "감사합니다. 여권을 확인했어요. 오늘 어느 도시로 가시나요?" };
    }
    if (yes) {
      return { reply: "All right. Can you show the document to me now?", ko: "알겠습니다. 지금 그 서류를 보여주시겠어요?" };
    }
    if (no || signalsMissingOrUnavailable(text)) {
      return { reply: "Check-in must pause until you have an accepted travel document. Can you retrieve your passport?", ko: "허용되는 여행 서류가 있어야 체크인할 수 있어요. 여권을 가져올 수 있나요?" };
    }
    return { reply: "I still need an accepted travel document. Do you have your passport or another approved document?", ko: "허용되는 여행 서류가 필요해요. 여권이나 다른 승인된 서류가 있나요?" };
  }

  if (askedForPassport) {
    if (passportProvided) {
      return { reply: "Thank you, I can see your passport. Which city are you flying to today?", ko: "감사합니다. 여권을 확인했어요. 오늘 어느 도시로 가시나요?" };
    }
    if (yes) {
      return { reply: "Thank you. Please show me your passport when you're ready.", ko: "감사합니다. 준비되면 여권을 보여주세요." };
    }
    return { reply: "I haven't received a passport yet. Can you show it or tell me what happened?", ko: "아직 여권을 받지 못했어요. 보여주시거나 무슨 일이 있는지 말씀해 주시겠어요?" };
  }

  if (askedForDestination) {
    const destination = isNumberOnly(text) ? null : cleanAirportDestination(text);
    if (!destination) {
      return { reply: `I heard "${compactSnippet(text, 3)}," but I need a city name. Which city are you flying to?`, ko: "방금 답은 도시 이름으로 확인할 수 없어요. 어느 도시로 가시나요?" };
    }
    return { reply: `Thanks—I have ${destination} as your destination. How many bags would you like to check?`, ko: `${destination}행으로 확인했어요. 부칠 가방은 몇 개인가요?` };
  }

  if (askedForBags) {
    const count = lower.match(/\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/i)?.[0];
    if (!count) {
      return { reply: "I need the number of checked bags. How many bags are you checking?", ko: "부칠 가방의 개수가 필요해요. 몇 개인가요?" };
    }
    return { reply: `${sentenceCase(count)} checked bag${/^(?:one|1)$/i.test(count) ? "" : "s"}—thank you. Would you prefer a window or an aisle seat?`, ko: `부칠 가방 ${count}개로 확인했어요. 창가와 통로 중 어느 좌석이 좋으세요?` };
  }

  if (askedForSeat) {
    if (/\bwindow\b|창가/i.test(text)) return { reply: "A window seat is available. Your gate is B12, and boarding starts at 9:20.", ko: "창가 좌석으로 배정했어요. 게이트는 B12이고 9시 20분부터 탑승합니다." };
    if (/\baisle\b|통로/i.test(text)) return { reply: "An aisle seat is available. Your gate is B12, and boarding starts at 9:20.", ko: "통로 좌석으로 배정했어요. 게이트는 B12이고 9시 20분부터 탑승합니다." };
    return { reply: "I can offer a window or an aisle seat. Which do you prefer?", ko: "창가나 통로 좌석을 드릴 수 있어요. 어느 쪽을 원하세요?" };
  }

  // 대화 기록이 불완전해도 값의 종류로 복구하되, 숫자를 목적지로 확정하지 않는다.
  if (passportProvided) return { reply: "Thank you, I can see your passport. Which city are you flying to today?", ko: "감사합니다. 여권을 확인했어요. 오늘 어느 도시로 가시나요?" };
  if (isNumberOnly(text)) return { reply: "I heard a number, but I'm not sure what it refers to. Is that the number of checked bags?", ko: "숫자는 들었지만 무엇을 뜻하는지 확실하지 않아요. 부칠 가방 개수인가요?" };
  return { reply: "I haven't confirmed your travel document yet. May I see your passport, please?", ko: "아직 여행 서류를 확인하지 못했어요. 여권을 보여주시겠어요?" };
}

function contextualScenarioCore(system: string, messages: LLMMessage[], lastUser: string): ScenarioResponse {
  const title = lineValue(system, "장소/상황").toLowerCase();
  const turn = messages.filter((message) => message.role === "user" && !isGreetingTurn(message.content)).length;
  const text = lastUser.toLowerCase();
  const snippet = compactSnippet(lastUser, 7);

  if (title.includes("cafe")) {
    const cafeHistory = messages.map((message) => message.content).join(" ").toLowerCase();
    const hasOrder = /\b(?:coffee|americano|latte|tea|mocha|drink|small|medium|large|to go|for here)\b|커피|아메리카노|라테|음료|포장|매장/i.test(cafeHistory);
    const completesOrder = /\b(?:that'?s all|that is all|nothing else|no(?:thing)? more|all done|no,? thanks|thank you|thanks)\b|이게\s*다|이상이에요|더는\s*없|됐어요|괜찮아요|감사/i.test(text);
    if (hasOrder && completesOrder) {
      const takeaway = /\b(?:to go|takeout)\b|포장/i.test(cafeHistory);
      return takeaway
        ? { reply: "You're all set—your takeaway drink will be ready at the pickup counter shortly. Thanks!", ko: "주문이 모두 완료됐어요. 포장 음료는 곧 픽업대에서 준비해드릴게요. 감사합니다!" }
        : { reply: "You're all set. We'll bring your drink over as soon as it's ready. Thanks!", ko: "주문이 모두 완료됐어요. 준비되는 대로 음료를 가져다드릴게요. 감사합니다!" };
    }
    if (/\b(?:i paid|payment|paid by card|card went through)\b|결제|계산했|카드.*됐/i.test(text)) {
      return { reply: "Your payment went through, and the order is complete. Your drink will be ready shortly.", ko: "결제가 완료됐고 주문도 접수됐어요. 음료는 곧 준비됩니다." };
    }
    if (/\b(?:to go|takeout)\b|포장/i.test(text)) return { reply: "To go—got it. You can tap your card right here when you're ready.", ko: "포장이군요. 준비되면 여기 카드 단말기에 대주세요." };
    if (/\b(?:for here|here)\b|매장/i.test(text)) return { reply: "For here—perfect. I'll bring it to your table when it's ready.", ko: "매장에서 드시는군요. 준비되면 테이블로 가져다드릴게요." };
    if (/\b(?:small|medium|large|tall|grande|venti)\b|작은|중간|큰/i.test(text)) return { reply: `${sentenceCase(cleanOrderItem(lastUser))}—thanks. Is that for here or to go?`, ko: "사이즈 확인했어요. 매장에서 드시나요, 포장인가요?" };
    if (/\b(?:coffee|americano|latte|tea|mocha|drink)\b|커피|아메리카노|라테|차/i.test(text)) return { reply: `${sentenceCase(cleanOrderItem(lastUser))}—good choice. What size would you like?`, ko: "주문 확인했어요. 어떤 사이즈로 드릴까요?" };
    if (signalsMissingOrUnavailable(lastUser)) return { reply: "No problem—I haven't placed an order yet. Would you like coffee or tea?", ko: "괜찮아요. 아직 주문은 넣지 않았어요. 커피와 차 중 어떤 걸 원하세요?" };
    return { reply: "I haven't caught a drink order yet. Would you like coffee or tea?", ko: "아직 음료 주문을 정확히 듣지 못했어요. 커피와 차 중 어떤 걸 원하세요?" };
  }
  if (title.includes("airport")) {
    return airportScenarioResponse(messages, lastUser);
  }
  if (title.includes("hotel")) {
    if (/\b(?:night|day|week)\b|박|며칠/i.test(text)) return { reply: "I found that stay. Would you like breakfast information or the Wi-Fi details?", ko: "숙박 일정을 찾았어요. 조식과 와이파이 중 어떤 정보를 원하세요?" };
    if (/\b(?:breakfast|wi-?fi|checkout)\b|조식|와이파이|체크아웃/i.test(text)) return { reply: `Of course. I've noted '${snippet}', and your room key is ready.`, ko: "요청한 정보를 안내하고 객실 키를 준비했어요." };
    if (signalsMissingOrUnavailable(lastUser)) return { reply: "I understand—the reservation detail is missing. Can we try the booking name instead?", ko: "예약 정보가 없으시군요. 대신 예약자 이름으로 확인해볼까요?" };
    return { reply: "I couldn't confirm a reservation from that. What name is the booking under?", ko: "방금 답으로는 예약을 확인하지 못했어요. 어떤 이름으로 예약하셨나요?" };
  }
  if (title.includes("restaurant")) {
    if (/\b(?:bill|check|pay)\b|계산/i.test(text)) return { reply: "Certainly. I'll bring the check to your table now.", ko: "네, 지금 계산서를 가져다드릴게요." };
    if (/\b(?:recommend|suggest)\b|추천/i.test(text)) return { reply: "I'd recommend the grilled salmon; it's light and popular. Would you like that or something vegetarian?", ko: "가볍고 인기 있는 구운 연어를 추천해요. 그 메뉴와 채식 메뉴 중 어느 쪽이 좋으세요?" };
    if (/\b(?:allergy|without|no |less|extra)\b|알레르기|빼|덜|추가/i.test(text)) return { reply: `I've noted '${snippet}' for the kitchen. Would you like anything to drink?`, ko: "주방에 요청사항을 전달할게요. 음료도 주문하시겠어요?" };
    if (/\b(?:salmon|steak|pasta|burger|pizza|salad|soup|chicken|fish)\b|연어|스테이크|파스타|버거|피자|샐러드|수프|치킨/i.test(text)) return { reply: `I'll put in '${snippet}' for you. Do you have any allergies or changes for the dish?`, ko: "주문을 넣을게요. 알레르기나 변경할 사항이 있나요?" };
    return { reply: "I haven't entered an order yet. Would you like a recommendation or more time?", ko: "아직 주문은 넣지 않았어요. 추천을 받으시겠어요, 아니면 시간이 더 필요하세요?" };
  }
  if (title.includes("interview")) {
    const meaningfulAnswer = (lastUser.match(/[A-Za-z]{2,}/g)?.length ?? 0) >= 3 || (lastUser.match(/[가-힣]/g)?.length ?? 0) >= 5;
    if (turn <= 1 && meaningfulAnswer) return { reply: `Thank you—that gives me a clear introduction, especially '${snippet}'. Which experience best prepared you for this role?`, ko: "자기소개 잘 들었습니다. 이 직무에 가장 도움이 된 경험은 무엇인가요?" };
    if (turn <= 1) return { reply: "I didn't catch enough to understand your introduction. Could you tell me your current role in one sentence?", ko: "자기소개를 이해할 만큼 듣지 못했어요. 현재 하는 일을 한 문장으로 말해주시겠어요?" };
    if (/\b(?:experience|project|worked|job|team)\b|경험|프로젝트|일|팀/i.test(text)) return { reply: `That experience with '${snippet}' is relevant. What specific result did your work create?`, ko: "관련 있는 경험이네요. 그 일로 어떤 구체적인 결과를 만들었나요?" };
    return { reply: `I understand your point about '${snippet}'. Why do you want to join this company now?`, ko: "말씀하신 내용을 이해했어요. 지금 이 회사에 지원한 이유는 무엇인가요?" };
  }
  if (title.includes("date")) {
    const meaningfulAnswer = (lastUser.match(/[A-Za-z]{2,}/g)?.length ?? 0) >= 2 || (lastUser.match(/[가-힣]/g)?.length ?? 0) >= 3;
    if (turn <= 1 && meaningfulAnswer) return { reply: `I'm glad you made it, and '${snippet}' tells me a little about your day. What do you usually enjoy after work?`, ko: "와줘서 반가워. 퇴근 후에는 보통 뭘 즐겨 해?" };
    if (turn <= 1) return { reply: "I'm not sure I understood. Was the trip here easy or difficult?", ko: "정확히 이해하지 못했어. 여기 오는 길이 쉬웠어, 아니면 어려웠어?" };
    return { reply: `I like hearing that you enjoy '${snippet}'. What got you interested in it?`, ko: "그걸 좋아한다니 흥미롭네. 어떻게 관심을 갖게 됐어?" };
  }
  if (title.includes("hospital")) {
    if (/\b(?:since|started|yesterday|days?|week)\b|어제|시작|동안|며칠/i.test(text)) return { reply: "Thank you—that timing helps. On a scale from one to ten, how strong is the discomfort?", ko: "언제 시작됐는지 도움이 됐어요. 불편함은 1부터 10 중 어느 정도인가요?" };
    if (/\b(?:[1-9]|ten)\b|통증|아파/i.test(text) && turn > 1) return { reply: "I understand the level. For this practice, the next step is to describe any other symptoms clearly.", ko: "통증 정도를 확인했어요. 이제 다른 증상이 있는지 분명하게 설명해보세요. 실제 증상은 의료진에게 진료받아야 합니다." };
    if (isNumberOnly(lastUser)) return { reply: "I heard a number, but I need the symptom first. What part of your body hurts?", ko: "숫자는 들었지만 먼저 증상을 알아야 해요. 몸의 어느 부분이 아픈가요?" };
    return { reply: `I understand that '${snippet}' is bothering you. When did it start?`, ko: "어떤 증상이 불편한지 이해했어요. 언제 시작됐나요?" };
  }
  if (title.includes("shopping")) {
    if (/\b(?:small|medium|large|size|color|black|white|blue|red)\b|사이즈|색|검정|흰|파랑|빨강/i.test(text)) return { reply: `I'll look for '${snippet}'. Would you like to try it on?`, ko: "원하는 옵션을 찾아볼게요. 입어보시겠어요?" };
    if (/\b(?:too big|too small|fits|exchange|return|buy)\b|크|작|맞아|교환|환불|살게/i.test(text)) return { reply: "Thanks for telling me how it fits. I can bring one different size or help you check out.", ko: "착용감을 알려줘서 고마워요. 다른 사이즈를 가져오거나 결제를 도와드릴게요." };
    return { reply: "I haven't identified the item yet. Are you looking for a top, trousers, or something else?", ko: "아직 찾는 상품을 정확히 확인하지 못했어요. 상의, 바지, 아니면 다른 것을 찾으시나요?" };
  }
  return { reply: `I'm not sure what '${snippet}' means in this situation. Could you say it another way?`, ko: "이 상황에서 방금 말의 의미를 확실히 이해하지 못했어요. 다른 방식으로 말해주시겠어요?" };
}

function contextualScenario(system: string, messages: LLMMessage[], lastUser: string): ScenarioResponse {
  if (!isKoreanDominant(lastUser)) return contextualScenarioCore(system, messages, lastUser);

  const hint = mockHint(lastUser);
  const primary = hint.primary;
  if (!primary) {
    const fallback = contextualScenarioCore(system, messages, lastUser);
    return {
      ...fallback,
      reply: "I want to teach you the exact phrase, so please try a shorter Korean sentence.",
      ko: `뜻과 다른 영어를 가르치지 않기 위해 정확한 변환을 멈췄어요. 한국어 문장을 조금 짧게 말해 주세요. ${fallback.ko}`,
      suggestion: null,
    };
  }

  const roleResponse = contextualScenarioCore(system, messages, primary.en);
  return {
    reply: `In English, say: "${primary.en}" ${roleResponse.reply}`,
    ko: `영어로는 “${primary.en}”이라고 하면 자연스러워요. ${roleResponse.ko}`,
    suggestion: primary,
  };
}

function practiceQuestion(expression: ParsedExpression): string {
  const en = expression.en.toLowerCase();
  if (en.includes("from korea")) return "We just met in class. Where are you from?";
  if (en.includes("work as")) return "What do you do for work?";
  if (en.includes("free time")) return "What do you enjoy in your free time?";
  if (en.includes("how about you")) return "I love spicy food. How would you ask about my preference?";
  if (en.includes("nice talking")) return "Our chat is ending. What could you say to close it warmly?";
  if (en.includes("can i get")) return "You're at a café counter. What would you order?";
  if (en.includes("recommend")) return "It's your first visit and the menu is unfamiliar. What would you ask?";
  if (en.includes("pay by card")) return "You have no cash at the register. What would you ask?";
  if (en.includes("how do i get")) return "You're lost and need the station. How would you ask a local?";
  if (en.includes("say that again")) return "The directions were too fast. What would you ask me to do?";
  if (en.includes("are you free")) return "You want to see a friend this weekend. How would you begin?";
  if (en.includes("how about")) return "Suggest Saturday afternoon in one natural sentence.";
  if (en.includes("excited") || en.includes("nervous") || en.includes("exhausted")) return "Tell me how you feel today and give one reason.";
  if (en.includes("went to")) return "Tell me one place you visited last weekend.";
  if (en.includes("going to") || en.includes("thinking of")) return "Tell me one plan you have for the future.";
  if (en.includes("favor") || en.includes("mind helping")) return "You need help moving a heavy box. What would you say?";
  if (en.includes("opinion") || en.includes("agree")) return "Give me your opinion about working from home.";
  if (en.includes("speak to") || en.includes("leave a message")) return "You called an office and need Mr. Kim. What would you say?";
  return `Use "${expression.en}" in a short sentence about your life.`;
}

function learningOpening(system: string): { reply: string; ko: string } {
  const setting = lineValue(system, "상황");
  const tutorRole = lineValue(system, "당신 역할");
  const learnerRole = lineValue(system, "학습자 역할");
  const goal = lineValue(system, "학습 목표");
  const lower = setting.toLowerCase();
  let reply = "Hi! Let's step into the scene. How would you begin?";
  if (/카페/.test(lower)) reply = "Hi! Welcome to the café. What can I get for you today?";
  else if (/첫날|처음 인사/.test(lower)) reply = "Hi, I think we're in the same class. I'm Alex. What's your name?";
  else if (/미술관|길/.test(lower)) reply = "You look a little lost. Can I help you find somewhere?";
  else if (/영화 약속|주말/.test(lower)) reply = "Hey, I'd love to see a movie this weekend. Are you free?";
  else if (/기분/.test(lower)) reply = "It's been a while! How have you been feeling lately?";
  else if (/휴가|여행담/.test(lower)) reply = "Welcome back! Where did you go on your trip?";
  else if (/새해/.test(lower)) reply = "The new year is coming. What are you planning to do?";
  else if (/이사/.test(lower)) reply = "Those boxes look heavy. Is there something you want to ask me?";
  else if (/재택근무/.test(lower)) reply = "I actually prefer the office to working from home. What do you think?";
  else if (/회사에 전화/.test(lower)) reply = "Good afternoon, Greenfield Company. How may I help you?";
  return { reply, ko: `상황: ${setting}\n역할: 튜터는 ${tutorRole}, 학습자는 ${learnerRole}\n목표: ${goal}` };
}

function contextualLearning(system: string, lastUser: string): MockOutput {
  const base = makeBase(lastUser);
  const stage = system.match(/## 현재 단계: (\w+)/)?.[1] ?? system.match(/현재 단계: (\w+)/)?.[1] ?? "review";
  const expressions = parseExpressions(system);
  const lowerUser = normalizeForMatch(lastUser);
  const used = expressions
    .filter((expression) => {
      const target = normalizeForMatch(expression.en.replace(/[.?!]$/, ""));
      const words = target.split(" ");
      const prefix = words.slice(0, Math.min(5, words.length)).join(" ");
      return prefix.length > 4 && lowerUser.includes(prefix);
    })
    .map((expression) => expression.id);
  base.used_expressions = used;

  if (wantsToEnd(lastUser)) {
    base.reply = "Of course—we can stop here. You did solid work today, and we'll pick it up next time.";
    base.reply_ko = "물론이죠. 여기서 마칠게요. 오늘 잘했고 다음에 이어서 해요.";
    base.end_call = true;
    return base;
  }

  if (/(?:무슨 뜻|뜻이|모르겠|이해.*안|what does .*mean|what do you mean|i don'?t understand)/i.test(lastUser)) {
    const target = expressions.find((expression) => lowerUser.includes(normalizeForMatch(expression.en).split(" ").slice(0, 3).join(" "))) ?? expressions[0];
    if (target) {
      base.reply = `No problem. "${target.en}" matches the Korean meaning below. Listen once, and then we can try it slowly.`;
      base.reply_ko = `괜찮아요. “${target.en}”은 “${target.ko}”라는 뜻이에요. 한 번 듣고 천천히 연습해요.`;
    } else {
      base.reply = "No problem. Tell me which word felt unclear, and I'll explain just that part.";
      base.reply_ko = "괜찮아요. 어떤 단어가 헷갈렸는지 말해주면 그 부분만 설명할게요.";
    }
    return base;
  }

  const judgmentTarget = system.match(/학습자가 방금 "([^"]+)" 를 따라 말했고/)?.[1];
  const judgmentPassed = /점\(통과\)/.test(system);
  const judgmentFailed = /점\(미통과\)/.test(system);
  const stageTurns = Number(system.match(/현재 단계에서 오간 튜터 턴 수: (\d+)/)?.[1] ?? 0);

  if (stage === "review") {
    const noReview = /복습 대상:\s*\(없음\)/.test(system);
    if (noReview) {
      const unitLine = lineValue(system, "유닛");
      const englishTitle = unitLine.match(/^([^（(—]+?)(?:\s*[（(]|\s*—|$)/)?.[1]?.trim() || "useful real-life English";
      const koreanTitle = unitLine.match(/[（(]([^）)]+)[）)]/)?.[1]?.trim() || "실생활 영어";
      base.reply = `Today we'll practise ${englishTitle}, one short step at a time. Are you ready to begin?`;
      base.reply_ko = `오늘은 ${koreanTitle}를 짧게 한 단계씩 연습해요. 시작할 준비됐나요?`;
      base.stage_signal = "advance";
      return base;
    }
    if (used.length > 0 || judgmentPassed) {
      base.reply = `Yes—you used "${judgmentTarget ?? expressions.find((expression) => used.includes(expression.id))?.en ?? "that expression"}" in the right place. Let's recall one more in a new situation.`;
      base.reply_ko = "맞아요. 그 표현을 알맞게 사용했어요. 다른 상황에서 하나만 더 떠올려볼게요.";
      // 엔진이 모든 항목의 실제 pass 여부를 다시 검증하므로, 현재 성공을
      // 반영한 뒤 전환을 시도해도 미완료 복습은 건너뛰지 않는다.
      base.stage_signal = "advance";
      return base;
    }
    const reviewLine = system.match(/복습 대상:\s*([^\n]+)/)?.[1] ?? "";
    const targetText = reviewLine.split("|")[1]?.trim() ?? expressions[0]?.en;
    base.reply = stageTurns === 0 ? "Let's warm up with one familiar idea. What did you do last weekend?" : `I understood '${compactSnippet(lastUser)}'. For this review, try: "${targetText}"`;
    base.reply_ko = stageTurns === 0 ? "익숙한 표현 하나로 몸을 풀어요. 지난 주말에 뭐 했나요?" : "말하려는 뜻은 이해했어요. 이번 복습에서는 제시된 문장으로 말해보세요.";
    if (stageTurns > 0 && targetText) base.suggestion = { en: targetText, ko: "복습 문장" };
    return base;
  }

  if (stage === "intro") {
    if (judgmentFailed && judgmentTarget) {
      base.reply = `I heard your attempt. Let's slow down the same sentence: "${judgmentTarget}" Say it once more, word by word.`;
      base.reply_ko = "시도한 문장 잘 들었어요. 같은 문장을 천천히 단어별로 한 번 더 말해봐요.";
      base.suggestion = { en: judgmentTarget, ko: "같은 문장을 천천히 다시 말해보세요." };
      return base;
    }
    const introIndex = Number(system.match(/표현을 (\d+)번째까지 소개했습니다/)?.[1] ?? 0);
    const next = expressions[introIndex];
    if (!next) {
      base.reply = "You've now heard every expression. Let's use them in your own answers.";
      base.reply_ko = "이제 모든 표현을 들었어요. 직접 답하면서 사용해볼게요.";
      base.stage_signal = "advance";
      return base;
    }
    const passedReactions = [
      `Yes—"${stripTerminalPunctuation(judgmentTarget ?? "that sentence")}" came through clearly.`,
      `Nice work; I understood "${stripTerminalPunctuation(judgmentTarget ?? "that sentence")}" right away.`,
      `Good control on "${stripTerminalPunctuation(judgmentTarget ?? "that sentence")}"—the words were easy to follow.`,
    ];
    const reaction = judgmentPassed && judgmentTarget
      ? passedReactions[introIndex % passedReactions.length]
      : `Got it—you said '${compactSnippet(lastUser, 6)}'.`;
    const introductions = [
      `For the next situation, use: "${next.en}" Say it once.`,
      `Here's the next useful line: "${next.en}" Give it a try.`,
      `Now imagine the scene and say: "${next.en}"`,
    ];
    base.reply = `${reaction} ${introductions[introIndex % introductions.length]}`;
    base.reply_ko = `${judgmentPassed ? "방금 문장을 또렷하게 말했어요." : "방금 말한 내용 확인했어요."} 이번에는 “${next.en}”을 한 번 말해보세요.`;
    base.new_expression = next.id;
    base.suggestion = { en: next.en, ko: next.ko };
    if (introIndex === expressions.length - 1) base.stage_signal = "advance";
    return base;
  }

  if (stage === "practice") {
    const practicedRaw = system.match(/지금까지 연습된 표현:\s*([^\n)]+)/)?.[1] ?? "";
    const practiced = new Set(practicedRaw.split(",").map((id) => id.trim()).filter((id) => /^u\d+e\d+$/.test(id)));
    const passedExpression = judgmentTarget
      ? expressions.find((expression) => normalizeForMatch(judgmentTarget).includes(normalizeForMatch(expression.en).split(" ").slice(0, 4).join(" ")))
      : undefined;
    for (const id of used) practiced.add(id);
    if (judgmentPassed && passedExpression) practiced.add(passedExpression.id);

    if (used.length > 0 || (judgmentPassed && judgmentTarget)) {
      const exact = judgmentTarget ?? expressions.find((expression) => used.includes(expression.id))?.en ?? "that expression";
      if (practiced.size >= 3) {
        base.reply = `You used "${exact}" naturally, and you've now handled three different expressions. Let's put them into one short scene.`;
        base.reply_ko = "그 표현을 자연스럽게 사용했고, 서로 다른 표현 세 개를 연습했어요. 이제 짧은 상황에서 써볼게요.";
        base.stage_signal = "advance";
      } else {
        const next = expressions.find((expression) => !practiced.has(expression.id)) ?? expressions[0];
        base.reply = `Yes—"${exact}" worked well there. ${practiceQuestion(next)}`;
        base.reply_ko = "맞아요. 그 표현이 상황에 잘 맞았어요. 이제 아직 안 쓴 표현 하나를 연습해요.";
      }
      return base;
    }

    const target = expressions.find((expression) => !practiced.has(expression.id)) ?? expressions[0];
    if (!target) {
      base.reply = "You've covered the practice set. Let's move into the real situation.";
      base.reply_ko = "연습할 표현을 모두 다뤘어요. 실제 상황으로 넘어갈게요.";
      base.stage_signal = "advance";
      return base;
    }
    if (stageTurns === 0) {
      base.reply = practiceQuestion(target);
      base.reply_ko = `이 상황에서 “${target.ko}”라는 뜻이 되도록 영어로 답해보세요.`;
    } else {
      base.reply = `I understood that you meant '${compactSnippet(lastUser)}'. A natural answer for this situation is: "${target.en}" Say that once.`;
      base.reply_ko = `말하려는 뜻은 이해했어요. 이 상황에서는 “${target.en}”이라고 하면 자연스러워요.`;
      base.suggestion = { en: target.en, ko: target.ko };
    }
    return base;
  }

  if (stage === "roleplay") {
    if (stageTurns === 0) {
      const opening = learningOpening(system);
      base.reply = opening.reply;
      base.reply_ko = opening.ko;
      return base;
    }
    const roleplayRaw = system.match(/지금까지 사용:\s*([^\n)]+)/)?.[1] ?? "";
    const roleplayUsed = new Set(roleplayRaw.split(",").map((id) => id.trim()).filter((id) => /^u\d+e\d+$/.test(id)));
    for (const id of used) roleplayUsed.add(id);
    if (roleplayUsed.size >= 2) {
      base.reply = `That worked—you responded to the situation and used "${expressions.find((expression) => used.includes(expression.id))?.en ?? "the target expressions"}" naturally. Scene complete!`;
      base.reply_ko = "상황에 맞게 응답했고 목표 표현도 자연스럽게 사용했어요. 상황극 완료!";
      base.stage_signal = "advance";
      return base;
    }
    if (used.length > 0) {
      const next = expressions.find((expression) => !roleplayUsed.has(expression.id)) ?? expressions[0];
      base.reply = `I understood you, and "${expressions.find((expression) => used.includes(expression.id))?.en}" fit the scene. ${practiceQuestion(next)}`;
      base.reply_ko = "방금 표현이 상황에 잘 맞았어요. 이제 다른 표현 하나를 자연스럽게 써보세요.";
      return base;
    }
    const target = expressions.find((expression) => !roleplayUsed.has(expression.id)) ?? expressions[0];
    base.reply = `I understand you mean '${compactSnippet(lastUser)}'. In this role, a natural line would be: "${target.en}"`;
    base.reply_ko = `말하려는 뜻을 이해했어요. 이 역할에서는 “${target.en}”이라고 하면 자연스러워요.`;
    base.suggestion = { en: target.en, ko: target.ko };
    return base;
  }

  base.reply = "You stayed with the conversation and used today's English in context. Great work—talk to you next time!";
  base.reply_ko = "대화 흐름을 따라 오늘의 영어를 상황 속에서 사용했어요. 정말 잘했어요. 다음에 또 만나요!";
  base.end_call = true;
  return base;
}

export async function chatMock(opts: {
  system: string;
  messages: LLMMessage[];
  maxTokens?: number;
  feature: string;
}): Promise<LLMResult> {
  const { system } = opts;
  const lastUser = [...opts.messages].reverse().find((message) => message.role === "user")?.content ?? "";
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
  if (system.includes("세션 요약")) return json({ facts: [] });

  if (system.includes("# 한국어 입력 코칭 카드")) {
    const learnerText = system.split("## 학습자가 쓴 한국어")[1]?.split("##")[0]?.trim() ?? lastUser;
    return json(mockCoachingCard(learnerText));
  }

  if (system.includes("# 일상 사진 메시지")) {
    const alt = lineValue(system, "- 무엇이 찍혔는가") || "a photo from my day";
    return json({
      text: `Look at this — ${alt}. Have you ever tried something like this?`,
      ko: `이것 좀 봐 — ${alt}. 이런 거 해본 적 있어?`,
      teachFocus: "사진 속 장면을 묘사하고 감상 말하기",
    });
  }

  if (system.includes("# 친구의 소개로 보내는 첫 메시지")) {
    const name = lineValue(system, "- ") || "your new friend";
    return json({
      text: `Hey! A friend told me about you and said we'd get along. I'm ${name.split(" ")[0] || "here"} — what have you been up to lately?`,
      ko: "안녕! 친구한테 네 얘기 듣고 우리 잘 맞을 것 같다고 해서 연락했어. 요즘 뭐 하고 지내?",
    });
  }

  if (system.includes("# 라이프 스케줄 생성")) {
    // 목 모드에서는 결정적 폴백 생성기가 일정을 만든다.
    return json({ events: [] });
  }
  if (system.includes("힌트 생성")) {
    const ko = system.split("## 학습자가 하고 싶은 말")[1]?.trim() ?? "";
    return json(mockHint(ko));
  }
  if (system.includes("레벨 테스트")) {
    const words = lastUser.split(/\s+/).filter(Boolean).length;
    const level = Math.max(1, Math.min(4, Math.round(words / 25) + 1));
    return json({ level, note: "목 모드 평가입니다. 실제 평가는 API 키 연결 후 이용하세요." });
  }

  // ── 대화 턴 ──
  const stageMatch = system.match(/## 현재 단계: (\w+)/) ?? system.match(/현재 단계: (\w+)/);
  if (stageMatch) return json(contextualLearning(system, lastUser));

  const base = makeBase(lastUser);
  if (/이번 턴 교정 카드:[^\n]*보류/.test(system)) base.correction = null;
  if (wantsToEnd(lastUser)) {
    base.reply = "It was lovely talking with you. Take care, and see you next time!";
    base.reply_ko = "얘기해서 즐거웠어. 잘 지내고 다음에 또 만나!";
    base.end_call = true;
    return json(base);
  }

  if (isGreetingTurn(lastUser)) {
    if (system.includes("# 시나리오 롤플레이")) {
      const opening = scenarioOpening(system);
      base.reply = opening.reply;
      base.reply_ko = opening.ko;
    } else {
      const greeting = personaGreeting(personaId(system));
      base.reply = greeting.reply;
      base.reply_ko = greeting.ko;
    }
    return json(base);
  }

  if (system.includes("# 시나리오 롤플레이")) {
    const response = contextualScenario(system, opts.messages, lastUser);
    base.reply = response.reply;
    base.reply_ko = response.ko;
    base.suggestion = response.suggestion ?? null;
    if (
      lineValue(system, "장소/상황").toLowerCase().includes("airport")
      && /^(?:sorry[, ]*)?i(?:'m| am)(?:\s+i(?:'m| am))*\s+(?:forgot|forget)(?:\s+(?:forgot|it))*[.!]*$/i.test(lastUser)
    ) {
      base.correction = {
        original: lastUser,
        better: "I'm sorry, I forgot my passport.",
        ko: "죄송하지만 여권을 깜빡했어요.",
        reason: "forgot 뒤에 잊은 대상인 my passport를 붙이면 뜻이 분명해져요",
        type: "awkward",
      };
    }
    return json(base);
  }

  const chatMode = system.includes("# 채팅 모드");
  if (!chatMode && isKoreanDominant(lastUser)) {
    const hint = mockHint(lastUser);
    if (hint.primary) {
      const response = adaptFreeTalkForLevel(
        system,
        hint.primary.en,
        contextualFreeTalk(system, opts.messages, hint.primary.en, false),
      );
      base.reply = `In English, say: "${hint.primary.en}" ${response.reply}`;
      base.reply_ko = `영어로는 “${hint.primary.en}”이라고 하면 자연스러워요. ${response.ko}`;
      base.suggestion = hint.primary;
      return json(base);
    }
    // For an unknown Korean sentence, keep the contextual response below
    // instead of inventing an unrelated stock translation.
  }
  const conversationalInput = chatMode && base.correction ? base.correction.better : lastUser;
  const response = adaptFreeTalkForLevel(
    system,
    conversationalInput,
    contextualFreeTalk(system, opts.messages, conversationalInput, chatMode),
  );
  base.reply = response.reply;
  base.reply_ko = response.ko;
  if (chatMode && base.correction) {
    base.reply = `You mean "${base.correction.better}" — got it. ${response.reply}`;
  }
  return json(base);
}
