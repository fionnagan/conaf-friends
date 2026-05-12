import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase";

// One-time reset endpoint — deletes all user submissions.
// Protected by a secret token passed as ?token=...
// DELETE AFTER USE.
const SECRET = "conaf-reset-2026";

export async function POST(req: NextRequest) {
  const token = new URL(req.url).searchParams.get("token");
  if (token !== SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const client = getServerClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const { error, count } = await client
    .from("submissions")
    .delete({ count: "exact" })
    .gte("created_at", "2000-01-01"); // match all rows

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: count, ok: true });
}
