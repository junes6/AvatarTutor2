/**
 * 디자인 토큰 회귀 — 색은 globals.css의 토큰 정의 블록에만 존재해야 한다.
 * 컴포넌트에 색을 직접 쓰면 테마 전환이 깨지고, 색 하나 바꾸는 데 여러 파일을 고쳐야 한다.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const COLOR = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;
const CSS_PATH = "src/app/globals.css";
/** 토큰 정의 블록의 끝 — 여기부터는 색 리터럴이 없어야 한다. */
const TOKEN_BOUNDARY = "html,\nbody {";

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(tsx|ts|css)$/.test(entry.name)) out.push(full.split(path.sep).join("/"));
  }
  return out;
}

function main() {
  const css = fs.readFileSync(CSS_PATH, "utf8");
  const boundary = css.indexOf(TOKEN_BOUNDARY);
  assert.ok(boundary > 0, "globals.css의 토큰 블록 경계를 찾지 못했습니다");

  const tokenBlock = css.slice(0, boundary);
  const cssBody = css.slice(boundary);

  // 1) 스펙이 정한 토큰이 모두 정의되어 있어야 한다.
  for (const token of [
    "--bg", "--surface", "--surface-alt", "--ink", "--ink-secondary", "--ink-tertiary", "--line",
    "--yellow", "--yellow-deep", "--yellow-soft", "--on-yellow",
    "--bubble-me-bg", "--bubble-me-text", "--bubble-you-bg", "--bubble-you-text",
    "--success", "--danger", "--shadow", "--pad", "--row-min",
  ]) {
    assert.ok(tokenBlock.includes(`${token}:`), `토큰 ${token} 정의가 없습니다`);
  }

  // 2) 라이트가 기본이고 다크 세트가 같은 토큰명을 쓴다.
  assert.ok(tokenBlock.includes(`:root[data-theme="dark"]`), "다크 테마 세트가 없습니다");
  assert.ok(tokenBlock.includes("prefers-color-scheme: dark"), "시스템 테마 대응이 없습니다");
  assert.match(tokenBlock, /:root \{[\s\S]*?--bg: #f7f7f8;/, "라이트가 기본값이어야 합니다");

  // 3) 통화 화면은 테마와 무관하게 어둡다.
  assert.match(tokenBlock, /\.call-live-shell[\s\S]{0,200}--bg: #0e0e12;/, "통화 화면 다크 고정이 없습니다");

  // 4) 애플 블루 계열은 완전히 제거되어야 한다.
  for (const blue of ["#0071e3", "#0a84ff", "--apple-blue", "--apple-green", "--apple-red"]) {
    const hits = walk("src").filter((file) => fs.readFileSync(file, "utf8").includes(blue));
    assert.deepEqual(hits, [], `${blue} 가 아직 남아 있습니다: ${hits.join(", ")}`);
  }

  // 5) 토큰 블록 밖에는 색 리터럴이 없어야 한다.
  const offenders: string[] = [];
  for (const file of walk("src")) {
    const source = file === CSS_PATH ? cssBody : fs.readFileSync(file, "utf8");
    for (const [index, line] of source.split("\n").entries()) {
      if (!COLOR.test(line)) { COLOR.lastIndex = 0; continue; }
      COLOR.lastIndex = 0;
      // 브라우저 크롬용 meta themeColor 는 CSS 변수를 쓸 수 없다 (문서화된 예외).
      if (file.endsWith("layout.tsx") && line.includes("prefers-color-scheme")) continue;
      offenders.push(`${file}:${index + 1} ${line.trim().slice(0, 80)}`);
    }
  }
  assert.deepEqual(offenders, [], `토큰 밖 하드코딩 색상:\n${offenders.join("\n")}`);

  // 6) 노랑 배경 위 텍스트는 항상 블랙(--on-yellow)이어야 한다.
  const yellowOnInk: string[] = [];
  for (const match of cssBody.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, selector, block] = match;
    const background = /(?:^|;)\s*background(?:-color|-image)?\s*:\s*([^;]+)/.exec(block)?.[1] ?? "";
    if (!/var\(--yellow\)|var\(--yellow-deep\)|var\(--bubble-me-bg\)/.test(background)) continue;
    if (/color\s*:\s*var\(--ink\)\s*[;}]/.test(block)) {
      yellowOnInk.push(selector.trim().replace(/\s+/g, " ").slice(0, 60));
    }
  }
  assert.deepEqual(yellowOnInk, [], `노랑 위에 --ink(다크에서 밝아짐)를 쓴 규칙:\n${yellowOnInk.join("\n")}`);

  // 7) 비활성은 투명도가 아니라 색으로 표현한다.
  const opacityDisabled = [...cssBody.matchAll(/([^{}]*:disabled[^{}]*)\{([^{}]*opacity:[^;}]*)/g)]
    .map((m) => m[1].trim());
  assert.deepEqual(opacityDisabled, [], `비활성에 opacity를 쓴 규칙:\n${opacityDisabled.join("\n")}`);

  console.log("design token regression: 토큰 정의, 테마 세트, 파랑 제거, 하드코딩 0건, 노랑 대비, 비활성 표현 통과");
}

main();
