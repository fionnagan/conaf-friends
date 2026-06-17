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

export function normalizeGuestName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^(dr|mr|mrs|ms|prof)\.\s+/i, '')
    // Canonicalise initials so "Louis C.K." / "Louis C K" / "Louis CK" all merge:
    // strip periods between/after single capitals, then collapse spaced single capitals.
    .replace(/\b([A-Z])\.(?=[A-Z. ]|$)/g, '$1')
    .replace(/\b([A-Z]) ([A-Z])\b/g, '$1$2');
}

export const USER_AGENT =
  'FriendRegistry-Bot/1.0 (fan project; github.com/friend-registry)';
