import guests from '../data/guests.json';
import fs from 'fs';
import path from 'path';

const context = (guests as any).guests.map((g: any) => {
  const appearances: any[] = g.appearances ?? [];
  const dates = appearances
    .map((a: any) => a.date as string)
    .filter(Boolean)
    .sort();

  // Per-era earliest appearance (date + on-air billing order). This lets the Q&A
  // agent compute each era's premiere date and first guest(s) deterministically,
  // instead of asking the model to scan ~3,000 rows for a minimum (which it does
  // unreliably — it would latch onto a famous early guest near the top of the list).
  const firstByEra: Record<string, { date: string; order: number }> = {};
  for (const a of appearances) {
    if (!a.era || !a.date) continue;
    const cur = firstByEra[a.era];
    const ord = typeof a.order === 'number' ? a.order : 999;
    if (!cur || a.date < cur.date || (a.date === cur.date && ord < cur.order)) {
      firstByEra[a.era] = { date: a.date, order: ord };
    }
  }

  // Cold opens: the word/phrase the guest gave about being Conan's friend at the top
  // of a podcast episode (the show's signature bit). Carry them so the agent can answer
  // "what did X say in their cold open?" — chronological, only appearances that have one.
  const coldOpens = appearances
    .filter((a: any) => a.coldOpenWord)
    .map((a: any) => ({
      date: a.date ?? '',
      word: a.coldOpenWord as string,
      sentiment: a.coldOpenSentiment ?? '',
    }))
    .sort((x: any, y: any) => (x.date || '').localeCompare(y.date || ''));

  return {
    id: g.id,
    name: g.name,
    professions: g.bio?.profession ?? [],
    totalAppearances: appearances.length,
    eras: [...new Set(appearances.map((a: any) => a.era).filter(Boolean))] as string[],
    firstAppearance: dates[0] ?? '',
    lastAppearance: dates[dates.length - 1] ?? '',
    appearanceYears: [...new Set(dates.map((d: string) => d.slice(0, 4)))].sort() as string[],
    firstByEra,
    coldOpens,
  };
});

const outPath = path.resolve('api/guests_context.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(context, null, 2));
console.log(`Wrote ${context.length} guests to api/guests_context.json`);
