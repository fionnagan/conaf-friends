import guests from '../data/guests.json';
import fs from 'fs';
import path from 'path';

const context = (guests as any).guests.map((g: any) => {
  const appearances: any[] = g.appearances ?? [];
  const dates = appearances
    .map((a: any) => a.date as string)
    .filter(Boolean)
    .sort();

  return {
    id: g.id,
    name: g.name,
    professions: g.bio?.profession ?? [],
    totalAppearances: appearances.length,
    eras: [...new Set(appearances.map((a: any) => a.era).filter(Boolean))] as string[],
    firstAppearance: dates[0] ?? '',
    lastAppearance: dates[dates.length - 1] ?? '',
    appearanceYears: [...new Set(dates.map((d: string) => d.slice(0, 4)))].sort() as string[],
  };
});

const outPath = path.resolve('api/guests_context.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(context, null, 2));
console.log(`Wrote ${context.length} guests to api/guests_context.json`);
