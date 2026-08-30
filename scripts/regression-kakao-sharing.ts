import assert from "node:assert/strict";

interface TestNavigator {
  userAgent?: string;
  share?: (data: ShareData) => Promise<void>;
  clipboard?: { writeText: (text: string) => Promise<void> };
}

function installGlobal(name: "window" | "navigator" | "document", value: unknown) {
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}

function fakeDocument(copyResult: boolean) {
  const textarea = {
    value: "",
    style: {} as Record<string, string>,
    setAttribute() {},
    select() {},
    setSelectionRange() {},
    remove() {},
  };
  return {
    createElement: () => textarea,
    body: { appendChild() {} },
    execCommand: (command: string) => command === "copy" && copyResult,
  };
}

async function main() {
  const saved = {
    window: Object.getOwnPropertyDescriptor(globalThis, "window"),
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    document: Object.getOwnPropertyDescriptor(globalThis, "document"),
  };
  const previousAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  const previousJavascriptKey = process.env.NEXT_PUBLIC_KAKAO_JAVASCRIPT_KEY;
  const previousChannelId = process.env.NEXT_PUBLIC_KAKAO_CHANNEL_ID;
  const previousSecret = process.env.KAKAO_SKILL_SECRET;
  try {
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.NEXT_PUBLIC_KAKAO_JAVASCRIPT_KEY;
    delete process.env.NEXT_PUBLIC_KAKAO_CHANNEL_ID;
    delete process.env.KAKAO_SKILL_SECRET;
    installGlobal("window", { location: { href: "http://localhost:3000/report/test" } });
    installGlobal("document", fakeDocument(false));

    const { shareToKakao } = await import("../src/lib/kakao");
    const nativePayloads: ShareData[] = [];
    installGlobal("navigator", {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile",
      share: async (payload: ShareData) => { nativePayloads.push(payload); },
    } as TestNavigator);
    let result = await shareToKakao({ title: "Mia와 영어 대화", text: "오늘 3번 말했어요." });
    assert.equal(result.method, "native");
    assert.equal(nativePayloads[0]?.url, undefined, "localhost must not be advertised as a cross-device link");
    assert.equal(result.includesLink, false);

    let copied = "";
    installGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Linux; Android 15) Mobile",
      share: async () => { throw new DOMException("share unavailable", "NotAllowedError"); },
      clipboard: { writeText: async (text: string) => { copied = text; } },
    } as TestNavigator);
    result = await shareToKakao({ title: "Oliver와 영어 대화", text: "표현을 배웠어요." });
    assert.equal(result.method, "clipboard", "native-share failures must continue to clipboard");
    assert.match(copied, /Oliver와 영어 대화/);
    assert.doesNotMatch(copied, /localhost/, "a recipient cannot open the sender's localhost URL");

    let desktopNativeCalls = 0;
    installGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      share: async () => { desktopNativeCalls += 1; },
      clipboard: { writeText: async (text: string) => { copied = text; } },
    } as TestNavigator);
    result = await shareToKakao({ title: "Desktop", text: "Copy without a hanging share sheet" });
    assert.equal(result.method, "clipboard");
    assert.equal(desktopNativeCalls, 0, "desktop shells must not leave the button waiting on navigator.share");

    installGlobal("navigator", {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile",
      share: async () => { throw new DOMException("cancelled", "AbortError"); },
    } as TestNavigator);
    await assert.rejects(
      () => shareToKakao({ title: "Cancelled", text: "Cancelled" }),
      (error: unknown) => error instanceof DOMException && error.name === "AbortError",
    );

    installGlobal("navigator", {
      clipboard: { writeText: async () => { throw new Error("insecure context"); } },
    } satisfies TestNavigator);
    installGlobal("document", fakeDocument(true));
    result = await shareToKakao({ title: "Jack와 영어 대화", text: "공항 표현을 배웠어요." });
    assert.equal(result.method, "clipboard", "LAN HTTP must use selection-copy fallback when Clipboard API is denied");

    installGlobal("document", fakeDocument(false));
    result = await shareToKakao({ title: "Manual", text: "Copy me" });
    assert.equal(result.method, "manual");
    assert.match(result.content, /Copy me/);

    const statusRoute = await import("../src/app/api/kakao/status/route");
    let response = await statusRoute.GET(new Request("http://localhost/api/kakao/status"));
    let status = await response.json();
    assert.equal(response.status, 200);
    assert.equal(status.share.nativeShareFallback, true);
    assert.equal(status.share.clipboardFallback, true);
    assert.equal(status.chatbot.ready, false);
    assert.ok(status.blockers.length >= 3);

    process.env.NEXT_PUBLIC_KAKAO_JAVASCRIPT_KEY = "public-js-key";
    process.env.NEXT_PUBLIC_KAKAO_CHANNEL_ID = "_avatarTutor";
    process.env.KAKAO_SKILL_SECRET = "server-secret";
    process.env.NEXT_PUBLIC_APP_URL = "https://tutor.example.com";
    response = await statusRoute.GET(new Request("https://tutor.example.com/api/kakao/status"));
    status = await response.json();
    assert.equal(status.channel.configured, true);
    assert.equal(status.chatbot.ready, true);
    assert.deepEqual(status.blockers, []);

    console.log("Kakao sharing regression: SDK-independent native, clipboard, LAN and manual fallbacks passed");
  } finally {
    for (const [name, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as Record<string, unknown>)[name];
    }
    const restore = (name: string, value: string | undefined) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    restore("NEXT_PUBLIC_APP_URL", previousAppUrl);
    restore("NEXT_PUBLIC_KAKAO_JAVASCRIPT_KEY", previousJavascriptKey);
    restore("NEXT_PUBLIC_KAKAO_CHANNEL_ID", previousChannelId);
    restore("KAKAO_SKILL_SECRET", previousSecret);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
