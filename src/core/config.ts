// 환경변수 → 설정. 키가 없으면 자동으로 목(mock) 모드로 동작한다.

export const config = {
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || "",
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
    thinking: (process.env.ANTHROPIC_THINKING || "disabled") as "disabled" | "adaptive",
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    sttModel: process.env.OPENAI_STT_MODEL || "gpt-4o-transcribe",
    ttsModel: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
  },
  tts: {
    provider: (process.env.TTS_PROVIDER || "openai") as "openai" | "elevenlabs",
  },
  elevenlabs: { apiKey: process.env.ELEVENLABS_API_KEY || "" },
  azure: {
    key: process.env.AZURE_SPEECH_KEY || "",
    region: process.env.AZURE_SPEECH_REGION || "koreacentral",
  },
  avatar: {
    layer: process.env.NEXT_PUBLIC_AVATAR_LAYER || "auto",
    l2Provider: (process.env.AVATAR_L2_PROVIDER || "anam") as "anam" | "simli",
    anamKey: process.env.ANAM_API_KEY || "",
    simliKey: process.env.SIMLI_API_KEY || "",
  },
  push: {
    publicKey: process.env.VAPID_PUBLIC_KEY || "",
    privateKey: process.env.VAPID_PRIVATE_KEY || "",
    subject: process.env.VAPID_SUBJECT || "mailto:admin@example.com",
  },
};

export const isMockLLM = () => !config.anthropic.apiKey;
export const isMockSTT = () => !config.openai.apiKey;
export const isMockTTS = () =>
  config.tts.provider === "elevenlabs" ? !config.elevenlabs.apiKey : !config.openai.apiKey;

// /admin 원가 추정용 단가 (2026-08 기준 추정치 — 필요 시 여기만 수정)
export const PRICING = {
  llmInputPerMTok: 3.0, // claude-sonnet-5 $/1M input tokens
  llmOutputPerMTok: 15.0, // claude-sonnet-5 $/1M output tokens
  sttPerMinute: 0.006, // whisper/gpt-4o-transcribe $/분
  ttsPerMChars: 12.0, // gpt-4o-mini-tts $/1M chars (추정)
  usdToKrw: 1380,
};
