import { NextRequest, NextResponse } from "next/server";

function basicAuthResponse(status: 401 | 503, message: string) {
  return new NextResponse(message, {
    status,
    headers: status === 401
      ? { "WWW-Authenticate": 'Basic realm="AvatarTutor", charset="UTF-8"', "Cache-Control": "no-store" }
      : { "Cache-Control": "no-store" },
  });
}

function isCrossSiteMutation(request: NextRequest): boolean {
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") return false;
  if (request.headers.get("sec-fetch-site") === "cross-site") return true;
  const origin = request.headers.get("origin");
  if (!origin) return false; // CLI/서버 호출은 Basic 인증으로 보호한다.
  try {
    const requestOrigin = new URL(origin).origin;
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
    const effectiveProtocol = forwardedProto === "http" || forwardedProto === "https"
      ? `${forwardedProto}:`
      : request.nextUrl.protocol;

    const hosts = new Set<string>();
    const host = request.headers.get("host")?.trim();
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    if (host) hosts.add(host);
    if (forwardedHost) hosts.add(forwardedHost);

    const allowedOrigins = new Set<string>();
    for (const candidateHost of hosts) {
      try {
        allowedOrigins.add(new URL(`${effectiveProtocol}//${candidateHost}`).origin);
      } catch {}
    }
    if (allowedOrigins.size === 0) allowedOrigins.add(request.nextUrl.origin);
    return !allowedOrigins.has(requestOrigin);
  } catch {
    return true;
  }
}

/**
 * AvatarTutor's JSON store is intentionally single-user. Production web routes
 * therefore fail closed behind HTTP Basic auth, while Kakao's isolated skill
 * endpoint uses its own x-avatar-tutor-secret validation.
 */
export function proxy(request: NextRequest) {
  if (/^\/api\/kakao\/skill\/?$/.test(request.nextUrl.pathname)) return NextResponse.next();

  // 브라우저의 상태 변경 요청은 개발 환경에서도 같은 출처만 허용한다.
  if (isCrossSiteMutation(request)) {
    return new NextResponse("Cross-site request blocked.", {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const expectedUser = process.env.APP_BASIC_USER ?? "";
  const expectedPassword = process.env.APP_BASIC_PASSWORD ?? "";
  // 로컬 개발은 키 없이 사용할 수 있지만, 둘 다 설정하면 모바일/LAN 테스트도
  // 운영과 동일한 Basic 인증으로 보호한다.
  if (process.env.NODE_ENV !== "production" && !expectedUser && !expectedPassword) {
    return NextResponse.next();
  }
  if (!expectedUser || !expectedPassword) {
    return basicAuthResponse(503, "Production access protection is not configured.");
  }

  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Basic ")) {
    return basicAuthResponse(401, "Authentication required.");
  }

  try {
    const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    const user = separator >= 0 ? decoded.slice(0, separator) : "";
    const password = separator >= 0 ? decoded.slice(separator + 1) : "";
    if (user === expectedUser && password === expectedPassword) {
      return NextResponse.next();
    }
  } catch {}

  return basicAuthResponse(401, "Invalid credentials.");
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest).*)"],
};
