// 환경변수 → 설정. 키가 없으면 자동으로 목(mock) 모드로 동작한다.

export type LLMProvider = "auto" | "anthropic" | "openai";

function llmProvider(value: string | undefined): LLMProvider {
  return value === "anthropic" || value === "openai" ? value : "auto";
}

function enabled(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

function anthropicThinking(value: string | undefined): "disabled" | "adaptive" {
  return value === "adaptive" ? "adaptive" : "disabled";
}

function ttsProvider(value: string | undefined): "openai" | "elevenlabs" {
  return value === "elevenlabs" ? "elevenlabs" : "openai";
}

function avatarProvider(value: string | undefined): "anam" | "simli" {
  return value === "simli" ? "simli" : "anam";
}

export const config = {
  llm: {
    provider: llmProvider(process.env.LLM_PROVIDER),
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || "",
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
    thinking: anthropicThinking(process.env.ANTHROPIC_THINKING),
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    llmModel: process.env.OPENAI_LLM_MODEL || "gpt-5.6-terra",
    sttModel: process.env.OPENAI_STT_MODEL || "gpt-4o-transcribe",
    ttsModel: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
    realtimeModel: process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1",
    realtimeTranscriptionModel: process.env.OPENAI_REALTIME_TRANSCRIPTION_MODEL || "gpt-live-transcribe",
    realtimeEnabled: enabled(process.env.OPENAI_REALTIME_ENABLED),
  },
  tts: {
    provider: ttsProvider(process.env.TTS_PROVIDER),
  },
  elevenlabs: { apiKey: process.env.ELEVENLABS_API_KEY || "" },
  azure: {
    key: process.env.AZURE_SPEECH_KEY || "",
    region: process.env.AZURE_SPEECH_REGION || "koreacentral",
  },
  avatar: {
    layer: process.env.NEXT_PUBLIC_AVATAR_LAYER || "auto",
    l2Provider: avatarProvider(process.env.AVATAR_L2_PROVIDER),
    anamKey: process.env.ANAM_API_KEY || "",
    simliKey: process.env.SIMLI_API_KEY || "",
  },
  push: {
    publicKey: process.env.VAPID_PUBLIC_KEY || "",
    privateKey: process.env.VAPID_PRIVATE_KEY || "",
    subject: process.env.VAPID_SUBJECT || "mailto:admin@example.com",
  },
  photos: {
    unsplashKey: process.env.UNSPLASH_ACCESS_KEY || "",
    pexelsKey: process.env.PEXELS_API_KEY || "",
  },
  chat: {
    // 비동기 응답을 끄면(=0) 개발 중 흐름을 빠르게 확인할 수 있다.
    delayEnabled: process.env.CHAT_DELAY_ENABLED !== "0",
    // "지금 대화 중" 토글이 자동으로 꺼지기까지의 무입력 시간
    liveWindowMs: Number(process.env.CHAT_LIVE_WINDOW_MS || 5 * 60_000),
  },
};

export type ActiveLLMProvider = Exclude<LLMProvider, "auto"> | "mock";

/** Resolves once per process from server-only environment variables. */
export function getLLMProvider(): ActiveLLMProvider {
  if (config.llm.provider === "anthropic") return config.anthropic.apiKey ? "anthropic" : "mock";
  if (config.llm.provider === "openai") return config.openai.apiKey ? "openai" : "mock";
  if (config.anthropic.apiKey) return "anthropic";
  if (config.openai.apiKey) return "openai";
  return "mock";
}

export const isMockLLM = () => getLLMProvider() === "mock";
export const isMockSTT = () => !config.openai.apiKey;
// 선택 provider가 실패하거나 키가 없어도 다른 TTS provider로 폴백할 수 있다.
export const isMockTTS = () => !config.openai.apiKey && !config.elevenlabs.apiKey;
export const isRealtimeReady = () => config.openai.realtimeEnabled && Boolean(config.openai.apiKey);

// /admin 원가 추정용 단가 (2026-08 기준 추정치 — 필요 시 여기만 수정)
export const PRICING = {
  llmInputPerMTok: 3.0, // claude-sonnet-5 $/1M input tokens
  llmOutputPerMTok: 15.0, // claude-sonnet-5 $/1M output tokens
  sttPerMinute: 0.006, // whisper/gpt-4o-transcribe $/분
  ttsPerMChars: 12.0, // gpt-4o-mini-tts $/1M chars (추정)
  usdToKrw: 1380,
};
