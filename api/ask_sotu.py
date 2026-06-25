"""
api/ask_sotu.py — Dedicated Q&A endpoint for the "State of the Podcast" tracker page.

POST /api/ask_sotu  {"question": "how has Conan's stance on video changed?"}
  → {"answer": "..."}

Scoped ONLY to data/sotu-records.json — does not answer general guest/friendship-score
questions. Kept as a separate function (not a mode flag on api/ask.py) so the two
agents can't drift into answering outside their scope by accident.
"""

from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse
from pathlib import Path
import json, os, urllib.request, datetime

_INPUT_COST_PER_M       = 0.80   # Claude Haiku, per million tokens
_OUTPUT_COST_PER_M      = 4.00
_CACHE_READ_COST_PER_M  = 0.08
_CACHE_WRITE_COST_PER_M = 1.00
_NOTION_DB_ID           = '02062f64984c4a098a7ffbd821ea2e4a'
_NOTION_API             = 'https://api.notion.com/v1/pages'

_ERROR_REASONS = {
    403: "Same-origin check failed — request did not come from the website (likely a bot or direct API call).",
    413: "Request body exceeded the 2 KB size limit.",
    400: "Bad request — body was not valid JSON or question field was empty.",
    500: "Anthropic API key not found in Vercel environment variables.",
    502: "Upstream Claude API error — the call to Anthropic failed.",
}

SOTU_FILE        = Path(__file__).parent.parent / 'data' / 'sotu-records.json'
MAX_BODY_BYTES   = 2000
MAX_QUESTION_LEN = 500
MAX_TOKENS       = 600
MODEL            = 'claude-haiku-4-5'


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
          ip='', location='', device='', browser='', cache_read=0, cache_create=0):
    token = (os.environ.get('NOTION_TOKEN') or os.environ.get('NotionCONAFmap')
             or os.environ.get('NotionConnectionCONAFMAPASK', ''))
    if not token:
        return
    fresh_in   = getattr(usage, 'input_tokens', 0) if usage else 0
    output_tok = getattr(usage, 'output_tokens', 0) if usage else 0
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
            'Question':     {'title':     [{'text': {'content': f'[SOTU] {question}'[:2000]}}]},
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


SYSTEM_TEMPLATE = """You are the Q&A assistant for the "State of the Podcast" tracker \
page on the CONAF Friend Registry — a fan site about Conan O'Brien's shows.

Your ONLY scope is the recurring "State of the Podcast" segment, where Conan, Sona \
Movsesian, and Matt Gourley check in on the show's direction, format, and (since 2023) \
business metrics — explicitly modeled on a presidential State of the Union address. \
You do NOT answer general questions about Conan's guests, friendship scores, or cold \
opens — politely redirect those to the main "Ask the Registry" box elsewhere on the site.

Below is every segment logged so far, with its date, a paraphrased summary, topics, and \
any concrete metrics mentioned (subscriber counts, episode milestones, press rankings, \
brand-safety scores). This is the ONLY source of truth — never invent a detail, date, \
number, or quote beyond what's here.

{sotu_digest}

Rules:
- Be concise and friendly — 1-4 sentences or a short list. This shows on a fan website.
- Always cite the segment by title and date when answering.
- For year-over-year / "how has X changed" questions, compare the relevant summaries \
directly — e.g. note the shift from resisting video (Nov 2024) to embracing YouTube as \
the dominant platform (late 2025/2026).
- If metrics for a record are marked unclear or unverified, say so rather than stating \
the number as fact.
- If the question is outside scope (about a specific guest, friendship score, cold open, \
etc.), say this page only covers the State of the Podcast segments and point them to the \
main Ask the Registry box for guest questions.
- If you don't have the answer in the data above, say so — never guess."""


def _load_sotu_records():
    try:
        with open(SOTU_FILE, encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def _build_sotu_digest(records):
    """Curated, pre-summarized — never raw transcript text."""
    if not records:
        return "(no State of the Podcast segments logged yet)"
    by_date = sorted(records, key=lambda r: r.get('air_date', ''))
    lines = []
    for r in by_date:
        topics = ', '.join(r.get('topics', []))
        metrics = r.get('metrics', [])
        metrics_str = '; '.join(f"{m.get('metric')}={m.get('value')}" for m in metrics)
        line = (
            f"- {r.get('air_date')} — \"{r.get('title')}\" ({r.get('source_url')}): "
            f"{r.get('summary')} [topics: {topics}]"
        )
        if metrics_str:
            line += f" [metrics: {metrics_str}]"
        lines.append(line)
    return '\n'.join(lines)


_STATE = {}


def _state():
    if not _STATE:
        records = _load_sotu_records()
        _STATE['system'] = SYSTEM_TEMPLATE.format(sotu_digest=_build_sotu_digest(records))
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
            system = [{'type': 'text', 'text': st['system'],
                       'cache_control': {'type': 'ephemeral'}}]
            messages = [{'role': 'user', 'content': question}]

            msg = client.messages.create(
                model=MODEL, max_tokens=MAX_TOKENS, system=system, messages=messages,
            )
            u = msg.usage
            answer = ''.join(b.text for b in msg.content if b.type == 'text').strip()
            if not answer:
                answer = "Sorry — I couldn't find an answer to that. Try rephrasing your question."

            usage = type('U', (), {
                'input_tokens': getattr(u, 'input_tokens', 0) or 0,
                'output_tokens': getattr(u, 'output_tokens', 0) or 0,
            })()
            _log(question, answer=answer, usage=usage, status='Success',
                 ip=ip, location=location, device=device, browser=browser,
                 cache_read=getattr(u, 'cache_read_input_tokens', 0) or 0,
                 cache_create=getattr(u, 'cache_creation_input_tokens', 0) or 0)
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
