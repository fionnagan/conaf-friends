import * as fs from 'fs';
import * as path from 'path';

const CACHE_DIR = path.join(process.cwd(), 'scripts/cache');

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function ensureCacheDir(): void {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

export function readCache<T>(filename: string): T | null {
  ensureCacheDir();
  const p = path.join(CACHE_DIR, filename);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as T;
  } catch {
    return null;
  }
}

export function writeCache<T>(filename: string, data: T): void {
  ensureCacheDir();
  const p = path.join(CACHE_DIR, filename);
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Same person, spelled differently across sources (nicknames / spelling variants).
// Maps a variant (lower-cased) to the canonical display name so appearances merge.
const NAME_ALIASES: Record<string, string> = {
  'steven schirripa': 'Steve Schirripa', 'steven r schirripa': 'Steve Schirripa',
  'thomas hayden church': 'Thomas Haden Church',
  'jeffrey ross': 'Jeff Ross',
  'ed burns': 'Edward Burns',
  'josh jackson': 'Joshua Jackson',
  'christopher meloni': 'Chris Meloni',
  'nick turturro': 'Nicholas Turturro',
  'darryl hammond': 'Darrell Hammond',
  'kristen davis': 'Kristin Davis',
  'charles s dutton': 'Charles Dutton',
  'rob siegel': 'Robert Siegel',
};

export function normalizeGuestName(name: string): string {
  const n = name
    .trim()
    .replace(/\s+/g, ' ')
    // Strip an honorific only when a full "First Last" follows ("Dr. Jane Goodall" →
    // "Jane Goodall"), NOT for single-word stage names ("Dr. Phil", "Dr. Dre", "Dr. John").
    .replace(/^(dr|mr|mrs|ms|prof)\.\s+(?=[A-Z][a-z'’-]+\s+[A-Z])/i, '')
    // Canonicalise initials so "Louis C.K." / "Louis C K" / "Louis CK" all merge:
    // strip periods between/after single capitals, then collapse spaced single capitals.
    .replace(/\b([A-Z])\.(?=[A-Z. ]|$)/g, '$1')
    .replace(/\b([A-Z]) ([A-Z])\b/g, '$1$2');
  return NAME_ALIASES[n.toLowerCase()] ?? n;
}

export const USER_AGENT =
  'FriendRegistry-Bot/1.0 (fan project; github.com/friend-registry)';
