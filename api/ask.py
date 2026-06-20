"""
api/ask.py — Guest Q&A endpoint for the CONAF Friend Registry.

POST /api/ask  {"question": "who has the highest friendship score?"}
  → {"answer": "..."}
"""

from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse
from pathlib import Path
import json, os, urllib.request, datetime

_INPUT_COST_PER_M  = 0.80   # Claude Haiku, per million tokens
_OUTPUT_COST_PER_M = 4.00
_NOTION_DB_ID      = '02062f64984c4a098a7ffbd821ea2e4a'
_NOTION_API        = 'https://api.notion.com/v1/pages'

_ERROR_REASONS = {
    403: "Same-origin check failed — request did not come from the website (likely a bot or direct API call).",
    413: "Request body exceeded the 2 KB size limit.",
    400: "Bad request — body was not valid JSON or question field was empty.",
    500: "Anthropic API key not found in Vercel environment variables.",
    502: "Upstream Claude API error — the call to Anthropic failed.",
}


def _parse_ua(ua):
    import re
    ua = ua or ''
    if re.search(r'(?i)(tablet|ipad)', ua):
        device = 'Tablet'
    elif re.search(r'(?i)(mobile|android|iphone|ipod|blackberry|windows phone)', ua):
        device = 'Mobile'
    else:
        device = 'Desktop'
    for name, pattern in [
        ('Edge',    r'Edg(?:e)?/(\S+)'),
        ('Chrome',  r'(?:Chrome|CriOS)/(\S+)'),
        ('Firefox', r'(?:Firefox|FxiOS)/(\S+)'),
        ('Safari',  r'Version/(\S+).*Safari'),
        ('Samsung', r'SamsungBrowser/(\S+)'),
    ]:
        m = re.search(pattern, ua)
        if m:
            return device, f'{name}/{m.group(1).split(".")[0]}'
    return device, 'Other'


def _get_client_info(headers):
    ip = (headers.get('X-Forwarded-For') or headers.get('X-Real-IP') or '').split(',')[0].strip()
    city    = headers.get('X-Vercel-Ip-City', '')
    country = headers.get('X-Vercel-Ip-Country', '')
    location = ', '.join(filter(None, [city, country]))
    device, browser = _parse_ua(headers.get('User-Agent', ''))
    return ip, location, device, browser


_CACHE_READ_COST_PER_M  = 0.08   # Claude Haiku cache read  = 0.1x input
_CACHE_WRITE_COST_PER_M = 1.00   # Claude Haiku cache write = 1.25x input


def _log(question, answer='', usage=None, status='Success', error_reason='',
          ip='', location='', device='', browser='', cache_read=0, cache_create=0):
    token = (os.environ.get('NOTION_TOKEN') or os.environ.get('NotionCONAFmap')
             or os.environ.get('NotionConnectionCONAFMAPASK', ''))
    if not token:
        return
    fresh_in   = getattr(usage, 'input_tokens', 0) if usage else 0
    output_tok = getattr(usage, 'output_tokens', 0) if usage else 0
    # Total input processed = fresh + cache reads + cache writes (shown in the log);
    # cost applies the tiered Haiku pricing (cache reads are 10x cheaper).
    input_tok  = fresh_in + cache_read + cache_create
    cost_usd   = round(
        fresh_in/1_000_000*_INPUT_COST_PER_M
        + cache_read/1_000_000*_CACHE_READ_COST_PER_M
        + cache_create/1_000_000*_CACHE_WRITE_COST_PER_M
        + output_tok/1_000_000*_OUTPUT_COST_PER_M, 6)
    ts = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S')
    payload = json.dumps({
        'parent': {'database_id': _NOTION_DB_ID},
        'properties': {
            'Question':     {'title':     [{'text': {'content': question[:2000]}}]},
            'Answer':       {'rich_text': [{'text': {'content': answer[:2000]}}]},
            'Timestamp':    {'date':      {'start': ts, 'time_zone': 'UTC'}},
            'Status':       {'select':    {'name': status}},
            'Error Reason': {'rich_text': [{'text': {'content': error_reason[:500]}}]},
            'Input Tokens': {'number': input_tok},
            'Output Tokens':{'number': output_tok},
            'Est Cost USD': {'number': cost_usd},
            'IP':           {'rich_text': [{'text': {'content': ip[:100]}}]},
            'Location':     {'rich_text': [{'text': {'content': location[:100]}}]},
            'Device':       {'rich_text': [{'text': {'content': device}}]},
            'Browser':      {'rich_text': [{'text': {'content': browser}}]},
        }
    }).encode('utf-8')
    try:
        req = urllib.request.Request(_NOTION_API, data=payload, headers={
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token,
            'Notion-Version': '2022-06-28',
        }, method='POST')
        urllib.request.urlopen(req, timeout=5)
    except Exception:
        pass


CONTEXT_FILE     = Path(__file__).parent / 'guests_context.json'
MAX_BODY_BYTES   = 2000
MAX_QUESTION_LEN = 500
MAX_TOKENS       = 600
MODEL            = 'claude-haiku-4-5'

ERA_LABELS = {
    'late-night-nbc': 'Late Night (1993–2009)',
    'tonight-show':   'Tonight Show (2009–2010)',
    'tbs-conan':      'Conan (2010–2021)',
    'podcast':        'Conan O\'Brien Needs a Friend (2018–present)',
    'conan-must-go':  'Conan Must Go (2023–present)',
}

# Display order for era-by-era output (chronological).
ERA_ORDER = ['late-night-nbc', 'tonight-show', 'tbs-conan', 'podcast', 'conan-must-go']

# ── System prompt ──────────────────────────────────────────────────────────────
# The full 3,266-guest list is NOT placed in the prompt (that was ~188K tokens per
# call — 3.8x over the 50K-tokens/minute rate limit, and unreliable for the model to
# scan). Instead the prompt carries a small pre-computed DIGEST for aggregate
# questions, and a find_guests tool retrieves exact records for specific lookups.

SYSTEM_TEMPLATE = """You are the Q&A assistant for the CONAF Friend Registry — \
a fan-made archive of every guest who appeared on Conan O'Brien's shows and podcast \
across 30+ years of television and podcasting (1993–present).

The five eras (key: label):
- late-night-nbc: Late Night (1993–2009), NBC
- tonight-show: Tonight Show (2009–2010), NBC
- tbs-conan: Conan (2010–2021), TBS
- podcast: Conan O'Brien Needs a Friend (2018–present)
- conan-must-go: Conan Must Go (2023–present), Max

Cold opens: at the top of most podcast episodes, the guest answers how they feel about \
being Conan's friend with a single word or short phrase — the show's signature "cold open." \
Guest records from find_guests include these in a coldOpens list (date, word, sentiment) \
when available, so you CAN tell a fan what a guest said in their cold opens.

== PRE-COMPUTED STATS (authoritative — use for totals, rankings, premieres, and \
per-year / per-era counts; never recompute these yourself) ==
{digest}

== find_guests tool ==
You have a find_guests tool that returns exact records from the full archive. Call it \
when the question is about:
- a specific person — e.g. "has Bill Burr been on?", "how many times has X appeared?", \
"when did X first appear?", "what did X say in their cold open?" → pass name.
- a filtered subset the stats above don't already answer — e.g. guests in a given year, \
era, or profession → pass year / era / profession.
If find_guests returns count 0 or no results, say you have no record of that guest or \
appearance — do not guess or invent one.

Rules:
- Answer only about guests, their appearances, and their cold opens on Conan's shows. \
Decline unrelated off-topic questions politely.
- Be concise and friendly — 1–4 sentences or a short list. This shows on a fan website.
- Prefer the PRE-COMPUTED STATS for anything they cover; call find_guests for specifics.
- For premiere / first-guest questions, use the "Premiere of each show" stat. The first \
name listed for an era is the first guest who came out on air that night.
- For cold-open questions ("what did X say about being Conan's friend?", "X's cold opens"), \
read the guest's coldOpens list from find_guests and quote the word/phrase verbatim, with \
the episode date. If the list is empty, say you don't have a cold open recorded for them.
- If profession data is missing for a guest, say you don't have that detail rather than guessing.
- Always give a complete answer in one response. Never end with "Would you like me to...".
- Do not invent guests, dates, cold opens, or details not in the data."""


FIND_GUESTS_TOOL = {
    'name': 'find_guests',
    'description': (
        "Look up Conan guests by name, or filter the full guest archive by era, year, "
        "or profession. Use for any question about a specific person or a filtered "
        "subset. Returns exact records (name, professions, appearance count, eras, "
        "first/last appearance, years active, and cold opens — the words guests gave "
        "about being Conan's friend on the podcast)."
    ),
    'input_schema': {
        'type': 'object',
        'properties': {
            'name': {
                'type': 'string',
                'description': 'Full or partial guest name to look up (fuzzy matched, accent-insensitive).',
            },
            'era': {
                'type': 'string',
                'enum': ERA_ORDER,
                'description': 'Filter to guests who appeared in this era (use the era key).',
            },
            'year': {
                'type': 'integer',
                'description': 'Filter to guests who appeared in this calendar year, e.g. 2003.',
            },
            'profession': {
                'type': 'string',
                'description': 'Filter to guests with this profession, e.g. musician, actor, comedian, athlete.',
            },
            'limit': {
                'type': 'integer',
                'description': 'Max records to return (default 25, max 50).',
            },
        },
    },
}


def _load_guests():
    with open(CONTEXT_FILE, encoding='utf-8') as f:
        return json.load(f)


def _norm(s):
    import unicodedata, re
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9 ]', '', s.lower()).strip()


def _build_index(guests):
    """norm-name -> guest (first wins on collisions)."""
    idx = {}
    for g in guests:
        idx.setdefault(_norm(g['name']), g)
    return idx


def _build_digest(guests):
    from collections import Counter
    total = len(guests)

    by_appearances    = sorted(guests, key=lambda g: g.get('totalAppearances', 0), reverse=True)
    top25             = by_appearances[:25]
    one_timers        = sum(1 for g in guests if g.get('totalAppearances', 0) == 1)
    total_appearances = sum(g.get('totalAppearances', 0) for g in guests)
    ten_plus          = sum(1 for g in guests if g.get('totalAppearances', 0) >= 10)

    era_counts  = Counter(e for g in guests for e in g.get('eras', []))
    multi_era   = [g for g in guests if len(g.get('eras', [])) >= 3]
    # Use the real era keys (the bug here was checking 'must-go' instead of 'conan-must-go').
    all_eras    = set(ERA_ORDER)
    five_era    = [g for g in guests if all_eras.issubset(set(g.get('eras', [])))]
    year_counts = Counter(y for g in guests for y in g.get('appearanceYears', []))
    prof_counts = Counter(p for g in guests for p in g.get('professions', []))
    nbc_and_podcast = [g for g in guests
                       if 'late-night-nbc' in g.get('eras', [])
                       and 'podcast' in g.get('eras', [])]

    # Per-era premiere date + first guest(s) in on-air billing order, computed
    # deterministically from firstByEra (date + order). This is what makes
    # "who was Conan's first guest?" reliable instead of an LLM scan.
    era_debuts = {}
    for g in guests:
        for era, info in (g.get('firstByEra') or {}).items():
            era_debuts.setdefault(era, []).append(
                (info.get('date', ''), info.get('order', 999), g['name'])
            )
    premiere_lines = []
    for era in ERA_ORDER:
        debuts = [d for d in era_debuts.get(era, []) if d[0]]
        if not debuts:
            continue
        min_date = min(d[0] for d in debuts)
        first_guests = sorted((o, n) for d, o, n in debuts if d == min_date)
        names = ', '.join(n for _, n in first_guests)
        premiere_lines.append(f"  {ERA_LABELS.get(era, era)}: premiered {min_date} — first guest(s) in on-air order: {names}")

    lines = [
        f"Total unique guests: {total}",
        f"Total individual appearances: {total_appearances}",
        f"One-time guests: {one_timers}",
        f"Guests with 10+ appearances: {ten_plus}",
        "",
        "Top 25 guests by number of appearances:",
    ]
    for g in top25:
        eras_str = ', '.join(ERA_LABELS.get(e, e) for e in g.get('eras', []))
        lines.append(f"  {g['name']}: {g.get('totalAppearances')} appearances ({eras_str})")

    lines += ["", "Guests per era (unique guests who appeared in that era):"]
    for era in ERA_ORDER:
        if era_counts.get(era):
            lines.append(f"  {ERA_LABELS.get(era, era)}: {era_counts[era]} guests")

    lines += [
        "",
        f"Guests who appeared in 3+ eras: {len(multi_era)}",
        f"Guests who appeared in all 5 eras: {len(five_era)}",
    ]
    if five_era:
        lines.append("  All-5-era guests: " + ', '.join(g['name'] for g in five_era[:10]))
    lines.append(f"Guests who appeared on both Late Night (NBC) and the podcast: {len(nbc_and_podcast)}")

    if premiere_lines:
        lines += ["", "Premiere of each show (earliest broadcast date and first guest(s) in on-air order):"]
        lines += premiere_lines

    lines += ["", "Appearances by year (number of individual guest appearances logged):"]
    for year in sorted(year_counts):
        lines.append(f"  {year}: {year_counts[year]}")

    lines += ["", "Top professions (profession data is available for ~40% of guests):"]
    for prof, count in prof_counts.most_common(15):
        lines.append(f"  {prof}: {count} guests")

    return '\n'.join(lines)


def _compact(g):
    return {
        'name': g['name'],
        'professions': g.get('professions', []),
        'appearances': g.get('totalAppearances', 0),
        'eras': [ERA_LABELS.get(e, e) for e in g.get('eras', [])],
        'firstAppearance': g.get('firstAppearance', ''),
        'lastAppearance': g.get('lastAppearance', ''),
        'years': g.get('appearanceYears', []),
        'coldOpens': g.get('coldOpens', []),
    }


def _match_name(query, guests, index, limit):
    q = _norm(query)
    if not q:
        return []
    if q in index:
        return [index[q]]
    subs = [g for g in guests if q in _norm(g['name'])]
    if subs:
        subs.sort(key=lambda g: (not _norm(g['name']).startswith(q), -g.get('totalAppearances', 0)))
        return subs[:limit]
    import difflib
    close = difflib.get_close_matches(q, list(index.keys()), n=limit, cutoff=0.78)
    return [index[k] for k in close]


def _find_guests(args, guests, index):
    """Execute the find_guests tool. Returns a small JSON-able dict of exact records."""
    args = args or {}
    try:
        limit = min(max(int(args.get('limit', 25)), 1), 50)
    except (TypeError, ValueError):
        limit = 25

    name       = (args.get('name') or '').strip()
    era        = (args.get('era') or '').strip()
    year       = args.get('year')
    profession = (args.get('profession') or '').strip().lower()

    pool = _match_name(name, guests, index, limit) if name else list(guests)
    if era:
        pool = [g for g in pool if era in g.get('eras', [])]
    if year not in (None, ''):
        ys = str(year)[:4]
        pool = [g for g in pool if ys in g.get('appearanceYears', [])]
    if profession:
        pool = [g for g in pool if any(profession in p.lower() for p in g.get('professions', []))]

    total = len(pool)
    if not name:
        pool = sorted(pool, key=lambda g: g.get('totalAppearances', 0), reverse=True)
    results = [_compact(g) for g in pool[:limit]]
    return {'count': total, 'returned': len(results), 'truncated': total > len(results), 'results': results}


# Lazily-built singletons, reused across warm invocations.
_STATE = {}


def _state():
    if not _STATE:
        guests = _load_guests()
        _STATE['guests'] = guests
        _STATE['index']  = _build_index(guests)
        _STATE['system'] = SYSTEM_TEMPLATE.format(digest=_build_digest(guests))
    return _STATE


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        ip, location, device, browser = '', '', '', ''

        if not self._is_same_origin():
            ip, location, device, browser = _get_client_info(self.headers)
            _log('(blocked — same-origin)', status='Error', error_reason=_ERROR_REASONS[403],
                 ip=ip, location=location, device=device, browser=browser)
            return self._send(403, {'error': 'forbidden'})

        ip, location, device, browser = _get_client_info(self.headers)

        length = int(self.headers.get('Content-Length') or 0)
        if length <= 0 or length > MAX_BODY_BYTES:
            _log('(body too large)', status='Error', error_reason=_ERROR_REASONS[413],
                 ip=ip, location=location, device=device, browser=browser)
            return self._send(413, {'error': 'request too large'})

        try:
            payload = json.loads(self.rfile.read(length))
            question = str(payload.get('question', '')).strip()
        except Exception:
            _log('(invalid JSON)', status='Error', error_reason=_ERROR_REASONS[400],
                 ip=ip, location=location, device=device, browser=browser)
            return self._send(400, {'error': 'invalid JSON'})

        if not question:
            _log('(empty)', status='Error', error_reason=_ERROR_REASONS[400],
                 ip=ip, location=location, device=device, browser=browser)
            return self._send(400, {'error': 'empty question'})
        question = question[:MAX_QUESTION_LEN]

        api_key = (os.environ.get('ANTHROPIC_API_KEY') or os.environ.get('CLAUDE')
                   or os.environ.get('Anthropic_API') or os.environ.get('AnthropicAPI', ''))
        if not api_key:
            _log(question, status='Error', error_reason=_ERROR_REASONS[500],
                 ip=ip, location=location, device=device, browser=browser)
            return self._send(500, {'error': 'service not configured'})

        try:
            import anthropic
            client = anthropic.Anthropic(api_key=api_key)
            st = _state()
            # Cache the stable system prompt (instructions + digest) so it bills at
            # 0.1x on repeat calls and de-bills the 2nd turn of the tool loop.
            system = [{'type': 'text', 'text': st['system'],
                       'cache_control': {'type': 'ephemeral'}}]

            messages = [{'role': 'user', 'content': question}]
            fresh_in = out_tok = cache_read = cache_create = 0
            answer = ''

            for _ in range(4):  # 1 answer turn + up to a few tool round-trips
                msg = client.messages.create(
                    model=MODEL, max_tokens=MAX_TOKENS, system=system,
                    tools=[FIND_GUESTS_TOOL], messages=messages,
                )
                u = msg.usage
                fresh_in     += getattr(u, 'input_tokens', 0) or 0
                out_tok      += getattr(u, 'output_tokens', 0) or 0
                cache_read   += getattr(u, 'cache_read_input_tokens', 0) or 0
                cache_create += getattr(u, 'cache_creation_input_tokens', 0) or 0

                if msg.stop_reason == 'tool_use':
                    messages.append({'role': 'assistant', 'content': msg.content})
                    results = []
                    for block in msg.content:
                        if block.type == 'tool_use':
                            out = _find_guests(block.input, st['guests'], st['index']) \
                                if block.name == 'find_guests' else {'error': 'unknown tool'}
                            results.append({'type': 'tool_result', 'tool_use_id': block.id,
                                            'content': json.dumps(out)})
                    messages.append({'role': 'user', 'content': results})
                    continue

                answer = ''.join(b.text for b in msg.content if b.type == 'text').strip()
                break

            if not answer:
                answer = "Sorry — I couldn't find an answer to that. Try rephrasing your question."

            usage = type('U', (), {'input_tokens': fresh_in, 'output_tokens': out_tok})()
            _log(question, answer=answer, usage=usage, status='Success',
                 ip=ip, location=location, device=device, browser=browser,
                 cache_read=cache_read, cache_create=cache_create)
            return self._send(200, {'answer': answer})
        except Exception as exc:
            reason = f"{_ERROR_REASONS[502]} Detail: {type(exc).__name__}: {exc}"
            _log(question, status='Error', error_reason=reason[:500],
                 ip=ip, location=location, device=device, browser=browser)
            return self._send(502, {'error': 'upstream error'})

    def _is_same_origin(self):
        origin = self.headers.get('Origin') or self.headers.get('Referer') or ''
        if not origin:
            return False
        origin_host = urlparse(origin).netloc.lower()
        host = (self.headers.get('Host') or '').lower()
        return bool(origin_host) and origin_host == host

    def _send(self, code, obj):
        body = json.dumps(obj).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass
