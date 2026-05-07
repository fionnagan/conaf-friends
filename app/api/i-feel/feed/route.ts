import { NextRequest, NextResponse } from "next/server";
import { getPublicFeed } from "@/lib/submissions";

export const revalidate = 0; // Always fresh — realtime feed

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit  = Math.min(parseInt(searchParams.get("limit") ?? "20"), 50);
  const before = searchParams.get("before") ?? undefined;

  const entries = await getPublicFeed(limit, before);

  return NextResponse.json(entries, {
    headers: {
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
