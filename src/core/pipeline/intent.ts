// 대화 의도 판별 — 짧은 명시적 종료 표현만 통화 종료로 인정한다.

const ENGLISH_END_PATTERNS = [
  /^(?:(?:sorry|okay|well|alright|thanks|thank you)[,!]?\s+)*(?:goodbye|bye(?:\s+bye)?|see ya|talk to you later|see you later)(?:[,.!]?\s+(?:(?:i (?:have|need|got) to go|i gotta go|gotta go)(?:\s+(?:now|soon))?|i (?:have|need) to leave(?:\s+(?:now|soon))?|i(?:'m| am) leaving now))?[.!?~…]*$/i,
  /^(?:(?:sorry|okay|well|alright|thanks|thank you)[,!]?\s+)*(?:(?:i (?:have|need|got) to go|i gotta go|gotta go)(?:\s+(?:now|soon))?|i (?:have|need) to leave(?:\s+(?:now|soon))?|i(?:'m| am) leaving now|i(?:'m| am) done for today)(?:[,.!]?\s+(?:bye|goodbye|see ya))?[.!?~…]*$/i,
  /^(?:(?:let'?s|please|can we)\s+(?:end|stop|finish)(?:\s+(?:here|now|the (?:call|session|lesson)))?|(?:end|stop)\s+the\s+(?:call|session|lesson))[.!?~…]*$/i,
];

// 문장 전체가 종료 요청인 경우만 매칭한다. "그만큼", "숙제를 끝낼 수
// 없어서"처럼 다른 문장 속에 포함된 형태는 의도적으로 제외한다.
const KOREAN_END_PATTERN = /^(?:(?:미안(?:한데|하지만)?|죄송(?:한데|하지만)?)\s*)?(?:(?:이제|오늘은|그럼)\s*)?(?:그만(?!큼)(?:\s*(?:좀\s*)?(?:해|하자|할게|할래|해\s*줘|해주세요|할까요|할까|하겠습니다|하고\s*싶어))?|끝(?:내자|낼게|내\s*줘)?|종료(?:\s*(?:하자|할게|해\s*줘|해주세요|할까요))?|(?:통화|수업|레슨|세션)(?:을|를)?\s*(?:끝내자|끝낼게|끝내\s*줘|종료하자|종료해\s*줘|그만하자)|오늘은\s*여기까지(?:\s*(?:하자|할게|할래|할까요))?|여기까지(?:\s*(?:하자|할게|할래|할까요))?|나(?:는)?\s*(?:이제\s*)?(?:가봐야\s*(?:해|돼|할\s*것\s*같아)?|가야\s*(?:해|돼|겠다)?|갈게)|(?:가봐야|가야)\s*(?:해|돼|할\s*것\s*같아)|끊을게|끊어야\s*겠다|잘\s*가)(?:요)?[.!?~…]*$/i;

export function hasExplicitEndIntent(rawText: string): boolean {
  const text = rawText.replace(/\s+/g, " ").trim();
  if (!text) return false;
  return ENGLISH_END_PATTERNS.some((pattern) => pattern.test(text)) || KOREAN_END_PATTERN.test(text);
}
