import { NextResponse } from "next/server";

function isHttpsUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** Public, secret-free integration diagnostics used by the UI and deployment QA. */
export async function GET(req: Request) {
  const javascriptSdk = Boolean(process.env.NEXT_PUBLIC_KAKAO_JAVASCRIPT_KEY);
  const channel = Boolean(process.env.NEXT_PUBLIC_KAKAO_CHANNEL_ID);
  const chatbotSecret = Boolean(process.env.KAKAO_SKILL_SECRET);
  const requestUrl = new URL(req.url);
  const publicBaseUrl = process.env.NEXT_PUBLIC_APP_URL;
  const publicHttps = isHttpsUrl(publicBaseUrl)
    || (requestUrl.protocol === "https:" && requestUrl.hostname !== "localhost" && requestUrl.hostname !== "127.0.0.1");

  const blockers: string[] = [];
  if (!javascriptSdk) blockers.push("Kakao JavaScript SDK key is not configured; native share and copy fallbacks remain available.");
  if (!channel) blockers.push("Kakao channel public ID is not configured.");
  if (!chatbotSecret) blockers.push("Kakao chatbot skill secret is not configured.");
  if (!publicHttps) blockers.push("Kakao chatbot callbacks require a public HTTPS deployment URL.");

  return NextResponse.json({
    ok: true,
    share: {
      javascriptSdk,
      nativeShareFallback: true,
      clipboardFallback: true,
      manualCopyFallback: true,
    },
    channel: { configured: channel, sdkEnhanced: channel && javascriptSdk },
    chatbot: {
      endpoint: "/api/kakao/skill",
      secretConfigured: chatbotSecret,
      publicHttps,
      ready: chatbotSecret && publicHttps,
    },
    blockers,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
