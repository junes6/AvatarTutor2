// 유닛 상세 조회 (리포트의 표현 카드용)

import { NextResponse } from "next/server";
import { getUnit } from "@/core/content";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    return NextResponse.json({ unit: getUnit(id) });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
