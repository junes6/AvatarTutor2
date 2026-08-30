// 웹 푸시 구독 API

import { NextResponse } from "next/server";
import { isIP } from "node:net";
import { addSubscription } from "@/core/push";
import { config } from "@/core/config";

const MAX_JSON_BYTES = 16 * 1024;

function isPrivateEndpointHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (isIP(host) === 4) {
    const [a, b] = host.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (isIP(host) === 6) {
    return host === "::1" || host === "::" || host.startsWith("fc") || host.startsWith("fd") ||
      /^fe[89ab]/.test(host);
  }
  return false;
}

function isValidSubscription(value: unknown): value is Parameters<typeof addSubscription>[0] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const sub = value as Record<string, unknown>;
  if (typeof sub.endpoint !== "string" || sub.endpoint.length > 2_048) return false;
  try {
    const endpoint = new URL(sub.endpoint);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || isPrivateEndpointHost(endpoint.hostname)) {
      return false;
    }
  } catch {
    return false;
  }
  if (typeof sub.keys !== "object" || sub.keys === null || Array.isArray(sub.keys)) return false;
  const keys = sub.keys as Record<string, unknown>;
  return (
    typeof keys.p256dh === "string" && keys.p256dh.length > 0 && keys.p256dh.length <= 512 &&
    typeof keys.auth === "string" && keys.auth.length > 0 && keys.auth.length <= 256
  );
}

export async function GET() {
  return NextResponse.json(
    { publicKey: config.push.publicKey || null },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(req: Request) {
  try {
    const contentLength = Number(req.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BYTES) {
      return NextResponse.json({ error: "request too large" }, { status: 413 });
    }
    const sub = await req.json();
    if (!isValidSubscription(sub)) {
      return NextResponse.json({ error: "invalid subscription" }, { status: 400 });
    }
    addSubscription(sub);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    console.error("[api/push]", error);
    return NextResponse.json({ error: "push subscription failed" }, { status: 500 });
  }
}
