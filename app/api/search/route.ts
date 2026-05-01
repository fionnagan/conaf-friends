import { NextRequest, NextResponse } from "next/server";

interface ParsedFilters {
  eras?: string[];
  minAppearances?: number | null;
  dateRange?: [string, string] | null;
  occupations?: string[];
  nameHint?: string | null;
  chips?: { label: string; key: string }[];
}

export async function POST(req: NextRequest) {
  const { query } = (await req.json()) as { query: string };

  if (!query?.trim() || query.trim().length < 2) {
    return NextResponse.json({ chips: [] });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ chips: [] });
  }

  const today = new Date().toISOString().split("T")[0];

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        system: `You extract structured search filters from natural language queries about Conan O'Brien's guests.
Today: ${today}

Era values and aliases:
- "late-night-nbc": Late Night NBC, NBC, Late Night (1993-2009)
- "tonight-show": Tonight Show (2009-2010)
- "tbs-conan": TBS, Conan TBS, Conan on TBS (2010-2021)
- "podcast": Needs a Friend, podcast (2018-present)
- "conan-must-go": Conan Must Go (2023-present)

Time expressions: convert relative time ("2 years ago", "last year", "recently") to ISO date ranges using today's date.

Reply with JSON only, no explanation:
{
  "eras": [],
  "minAppearances": null,
  "dateRange": null,
  "occupations": [],
  "nameHint": null,
  "chips": [{"label": "human-readable chip text", "key": "era|date|min_appearances|occupation|name"}]
}

Only populate fields that are clearly implied by the query. Leave others null/empty.`,
        messages: [{ role: "user", content: query }],
      }),
    });

    if (!res.ok) return NextResponse.json({ chips: [] });

    const data = await res.json() as { content?: Array<{ type: string; text: string }> };
    const text = data.content?.[0]?.text ?? "{}";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return NextResponse.json({ chips: [] });

    const parsed: ParsedFilters = JSON.parse(match[0]);
    return NextResponse.json(parsed);
  } catch {
    return NextResponse.json({ chips: [] });
  }
}
