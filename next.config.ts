import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

function localDevOrigins(): string[] {
  const addresses = Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => !entry.internal && entry.family === "IPv4")
    .map((entry) => entry.address);
  return [...new Set(addresses)];
}

const nextConfig: NextConfig = {
  // `next dev`는 localhost 외 origin의 개발 청크를 기본 차단한다. 현재 PC의
  // 실제 IPv4 주소만 허용해 같은 Wi-Fi의 휴대폰 미리보기 링크가 빈 화면에
  // 머물지 않도록 한다. 이 설정은 운영 origin 허용/CORS와는 무관하다.
  allowedDevOrigins: localDevOrigins(),
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(self), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
