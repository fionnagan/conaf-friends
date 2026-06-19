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


def _log(question, answer='', usage=None, status='Success', error_reason='',
          ip='', location='', device='', browser=''):
    token = (os.environ.get('NOTION_TOKEN') or os.environ.get('NotionCONAFmap')
             or os.environ.get('NotionConnectionCONAFMAPASK', ''))
    if not token:
        return
    input_tok  = getattr(usage, 'input_tokens', 0) if usage else 0
    output_tok = getattr(usage, 'output_tokens', 0) if usage else 0
    cost_usd   = round(input_tok/1_000_000*_INPUT_COST_PER_M + output_tok/1_000_000*_OUTPUT_COST_PER_M, 6)
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
    'must-go':        'Conan Must Go (2023–present)',
}

SYSTEM_TEMPLATE = """You are the Q&A assistant for the CONAF Friend Registry — \
a fan-made archive of every guest who appeared on Conan O'Brien's shows and podcast \
across 30+ years of television and podcasting (1993–present).

The five eras:
- Late Night (1993–2009): NBC late night show
- Tonight Show (2009–2010): NBC primetime, short-lived
- Conan (2010–2021): TBS run
- Conan O'Brien Needs a Friend (2018–present): podcast
- Conan Must Go (2023–present): Max travel show

== PRE-COMPUTED STATS (use these for count/ranking questions — do NOT recompute from the list) ==
{stats}

== GUEST LIST (one line per guest) ==
name | professions | appearances | eras | first | last | years
{table}

Rules:
- Answer questions about guests and their appearances on Conan's shows only.
- Decline off-topic questions politely.
- Be concise and friendly — 1–4 sentences or a short list. This shows on a fan website.
- For COUNT or RANKING questions: read numbers directly from PRE-COMPUTED STATS. State once, confidently.
- For NAME/DETAIL questions: look up the guest in the list and answer directly.
- For YEAR questions: scan the "years" column to find guests with appearances in that year.
- For ERA questions: filter by the "eras" column.
- If profession data is missing for a guest (empty professions field), say you don't have that detail rather than guessing.
- Always give a complete answer. Never end with "Would you like me to..." — include everything in one response.
- Do not invent guests or details not in the data."""


def _load_guests():
    with open(CONTEXT_FILE, encoding='utf-8') as f:
        return json.load(f)


def _build_stats(guests):
    from collections import Counter
    total = len(guests)

    # Appearance counts
    by_appearances = sorted(guests, key=lambda g: g.get('totalAppearances', 0), reverse=True)
    top20 = by_appearances[:20]
    one_timers = sum(1 for g in guests if g.get('totalAppearances', 0) == 1)
    total_appearances = sum(g.get('totalAppearances', 0) for g in guests)

    # Era counts (guests per era)
    era_counts = Counter(e for g in guests for e in g.get('eras', []))

    # Cross-era guests
    multi_era = [g for g in guests if len(g.get('eras', [])) >= 3]

    # Guests who spanned all 5 eras
    all_eras = {'late-night-nbc', 'tonight-show', 'tbs-conan', 'podcast', 'must-go'}
    five_era = [g for g in guests if all_eras.issubset(set(g.get('eras', [])))]

    # Year distribution
    year_counts = Counter(y for g in guests for y in g.get('appearanceYears', []))

    # Profession counts (only for guests with profession data)
    prof_counts = Counter(p for g in guests for p in g.get('professions', []))

    # Guests who appeared in both NBC Late Night and podcast
    nbc_and_podcast = [g for g in guests
                       if 'late-night-nbc' in g.get('eras', [])
                       and 'podcast' in g.get('eras', [])]

    lines = [
        f"Total unique guests: {total}",
        f"Total individual appearances: {total_appearances}",
        f"One-time guests: {one_timers}",
        f"Guests with 10+ appearances: {sum(1 for g in guests if g.get('totalAppearances',0) >= 10)}",
        "",
        "Top 20 guests by number of appearances:",
    ]
    for g in top20:
        eras_str = ', '.join(ERA_LABELS.get(e, e) for e in g.get('eras', []))
        lines.append(f"  {g['name']}: {g.get('totalAppearances')} appearances ({eras_str})")

    lines += ["", "Guests per era (unique guests who appeared in that era):"]
    for era, count in era_counts.most_common():
        lines.append(f"  {ERA_LABELS.get(era, era)}: {count} guests")

    lines += [
        "",
        f"Guests who appeared in 3+ eras: {len(multi_era)}",
        f"Guests who appeared in all 5 eras: {len(five_era)}",
    ]
    if five_era:
        lines.append("  All-5-era guests: " + ', '.join(g['name'] for g in five_era[:10]))

    lines += [f"Guests who appeared on both Late Night NBC and the podcast: {len(nbc_and_podcast)}"]

    lines += ["", "Appearances by year (number of individual guest appearances logged):"]
    for year in sorted(year_counts):
        lines.append(f"  {year}: {year_counts[year]}")

    lines += ["", "Top professions (note: profession data is only available for ~10% of guests):"]
    for prof, count in prof_counts.most_common(15):
        lines.append(f"  {prof}: {count} guests")

    return '\n'.join(lines)


def _build_system_prompt(guests):
    stats = _build_stats(guests)
    lines = []
    for g in guests:
        eras = ', '.join(ERA_LABELS.get(e, e) for e in g.get('eras', []))
        profs = ', '.join(g.get('professions', [])) or '—'
        years = ', '.join(g.get('appearanceYears', []))
        lines.append(
            f"{g['name']} | {profs} | {g.get('totalAppearances', '')} apps | "
            f"{eras} | {g.get('firstAppearance', '')} → {g.get('lastAppearance', '')} | "
            f"years: {years}"
        )
    return SYSTEM_TEMPLATE.format(stats=stats, table='\n'.join(lines))


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
            system = _build_system_prompt(_load_guests())
            msg = client.messages.create(
                model=MODEL, max_tokens=MAX_TOKENS, system=system,
                messages=[{'role': 'user', 'content': question}],
            )
            answer = ''.join(b.text for b in msg.content if b.type == 'text').strip()
            _log(question, answer=answer, usage=msg.usage, status='Success',
                 ip=ip, location=location, device=device, browser=browser)
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
