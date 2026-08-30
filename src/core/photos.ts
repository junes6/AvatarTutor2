// 사진 소스 — Unsplash → Pexels → 로컬 샘플 순으로 시도한다.
// 키가 없으면 조용히 넘어가지 않고 source를 "local"로 명시해 UI가 표시할 수 있게 한다.

import { config } from "./config";
import type { ChatPhoto } from "./types";

const REQUEST_TIMEOUT_MS = 6_000;

/** 키워드를 로컬 샘플 장면으로 떨어뜨리는 규칙. 앞쪽이 더 구체적이다. */
const LOCAL_SCENES: { file: string; match: RegExp; alt: string }[] = [
  { file: "ramen", match: /ramen|noodle|pho|udon/i, alt: "김이 오르는 라멘 한 그릇" },
  { file: "bread", match: /bread|bakery|sourdough|pastry|pancake/i, alt: "갓 구운 빵" },
  { file: "cafe", match: /coffee|latte|espresso|cafe|café|brunch|matcha|milkshake/i, alt: "카페 테이블 위의 커피" },
  { file: "market", match: /market|produce|grocery|vegetable|farmers/i, alt: "색색의 시장 좌판" },
  { file: "food", match: /food|pizza|plate|dinner|bbq|barbecue|seafood|taco|pasta|bagel|breakfast|bowl/i, alt: "먹음직스러운 한 접시" },
  { file: "beach", match: /beach|ocean|sea|surf|coast|bondi|seawall/i, alt: "파도가 밀려오는 해변" },
  { file: "mountain", match: /mountain|hike|hiking|trail|alp|rainier|banff|lake|highlands|terrace/i, alt: "산과 호수가 보이는 풍경" },
  { file: "forest", match: /forest|tree|park|woods|garden/i, alt: "빛이 스며드는 숲길" },
  { file: "night", match: /night|neon|evening|bar|jazz|cinema|dark/i, alt: "불빛이 반짝이는 밤 풍경" },
  { file: "desk", match: /desk|monitor|code|studio|office|whiteboard|setup/i, alt: "작업 중인 책상" },
  { file: "room", match: /room|home|window|interior|shop|vintage|apartment/i, alt: "따뜻한 실내 풍경" },
  { file: "pet", match: /dog|cat|retriever|puppy|kitten|pet/i, alt: "카메라를 보는 반려동물" },
  { file: "street", match: /street|city|downtown|skyline|bridge|subway|laneway|town|soho/i, alt: "사람이 오가는 거리" },
];

function localPhoto(keyword: string): ChatPhoto {
  const scene = LOCAL_SCENES.find((entry) => entry.match.test(keyword)) ?? LOCAL_SCENES[LOCAL_SCENES.length - 1];
  return {
    url: `/photos/${scene.file}.svg`,
    alt: scene.alt,
    source: "local",
  };
}

interface UnsplashPhoto {
  id?: string;
  alt_description?: string | null;
  description?: string | null;
  urls?: { regular?: string; small?: string };
  links?: { html?: string };
  user?: { name?: string; links?: { html?: string } };
}

async function fromUnsplash(keyword: string, exclude: Set<string>): Promise<ChatPhoto | null> {
  if (!config.photos.unsplashKey) return null;
  const url = `https://api.unsplash.com/search/photos?per_page=12&orientation=landscape&content_filter=high&query=${encodeURIComponent(keyword)}`;
  const response = await fetch(url, {
    headers: { Authorization: `Client-ID ${config.photos.unsplashKey}`, "Accept-Version": "v1" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Unsplash ${response.status}`);
  const data = (await response.json()) as { results?: UnsplashPhoto[] };
  const results = data.results ?? [];
  const pick = results.find((item) => item.urls?.regular && !exclude.has(item.urls.regular));
  if (!pick?.urls?.regular) return null;
  return {
    url: pick.urls.regular,
    alt: pick.alt_description || pick.description || keyword,
    source: "unsplash",
    credit: {
      name: pick.user?.name ?? "Unsplash",
      // Unsplash 가이드라인상 사진가/사진 페이지로 되돌아가는 링크가 필요하다.
      link: pick.user?.links?.html ?? pick.links?.html ?? "https://unsplash.com",
    },
  };
}

interface PexelsPhoto {
  alt?: string;
  photographer?: string;
  url?: string;
  src?: { large?: string; medium?: string };
}

async function fromPexels(keyword: string, exclude: Set<string>): Promise<ChatPhoto | null> {
  if (!config.photos.pexelsKey) return null;
  const url = `https://api.pexels.com/v1/search?per_page=12&orientation=landscape&query=${encodeURIComponent(keyword)}`;
  const response = await fetch(url, {
    headers: { Authorization: config.photos.pexelsKey },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Pexels ${response.status}`);
  const data = (await response.json()) as { photos?: PexelsPhoto[] };
  const pick = (data.photos ?? []).find((item) => item.src?.large && !exclude.has(item.src.large));
  if (!pick?.src?.large) return null;
  return {
    url: pick.src.large,
    alt: pick.alt || keyword,
    source: "pexels",
    credit: { name: pick.photographer ?? "Pexels", link: pick.url ?? "https://www.pexels.com" },
  };
}

export interface FetchPhotoOptions {
  /** 이미 쓴 사진 URL — 같은 사진이 반복되지 않게 한다 */
  used?: string[];
}

/**
 * 키워드에 맞는 사진 한 장. 원격이 실패하면 로컬 샘플로 내려가되,
 * 반환된 source로 실제 어디서 왔는지 항상 알 수 있다.
 */
export async function fetchPhoto(keyword: string, options: FetchPhotoOptions = {}): Promise<ChatPhoto> {
  const exclude = new Set(options.used ?? []);
  for (const provider of [fromUnsplash, fromPexels]) {
    try {
      const photo = await provider(keyword, exclude);
      if (photo) return photo;
    } catch (error) {
      console.error(`[photos] ${provider.name} failed for "${keyword}":`, error);
    }
  }
  return localPhoto(keyword);
}

export function photosConfigured(): boolean {
  return Boolean(config.photos.unsplashKey || config.photos.pexelsKey);
}

/** 학습자가 보낸 사진 (data URL)을 채팅 첨부로 감싼다. */
export function learnerPhoto(dataUrl: string, alt: string): ChatPhoto {
  return { url: dataUrl, alt, source: "learner" };
}
