# Ask the Registry — Implementation Guide

> How to add a fan-facing Q&A agent to the CONAF Friend Registry.
> Based on the identical feature already live at conafmap.vercel.app ("Ask the Map").
> Hand this file to a Claude Code session — it contains everything needed to build from scratch.

---

## What this builds

A single-question Q&A box on the Friend Registry site. A visitor types a natural-language
question about Conan's guests ("who has the highest friendship score?", "which NBC-era guests
became Inner Circle friends?", "how many actors have appeared?") and gets a concise answer
powered by Claude Haiku, with every question+answer logged to a Notion database.

No chat history, no session state. One question → one answer. Simple on purpose.

---

## Reused infrastructure (no new accounts needed)

| Thing | Where it lives | How to access |
|---|---|---|
| Anthropic API key | Vercel env var named `Anthropic_API` | Already set on conafmap project — add same key to this project |
| Notion integration token | Vercel env var named `NotionCONAFmap` | Already set on conafmap project — add same token to this project |
| Notion Q&A log database | See database ID below | Create a **new** database (different from the Fan Map log) |

---

## Step 1 — Create a Notion database for this project

In Notion, create a new full-page database called **"Friend Registry — Q&A Log"** and add
these columns (the Notion MCP can do this in one call):

| Column | Type | Notes |
|---|---|---|
| Question | Title | auto |
| Answer | Rich Text | |
| Timestamp | Date | |
| Status | Select | options: Success (green), Error (red) |
| Error Reason | Rich Text | |
| Input Tokens | Number | |
| Output Tokens | Number | |
| Est Cost USD | Number | format: dollar |
| IP | Rich Text | |
| Location | Rich Text | city, country |
| Device | Rich Text | Mobile / Tablet / Desktop |
| Browser | Rich Text | e.g. Chrome/125 |
| Log ID | Unique ID | prefix: QA |

**Important:** Share the database with your Notion integration (open the database → ··· →
Connections → select your integration). Without this, API writes will return 404.

Save the database ID — it's the UUID in the database URL:
`https://app.notion.com/p/<DATABASE_ID_HERE>`

---

## Step 2 — Build the context file

The agent needs a flat JSON file of guest facts baked at build time — no live DB queries
at request time.

Create `api/guests_context.json` by running a script (or write it once by hand for testing).
Each entry should be a flat object with the fields Claude needs to answer questions:

```json
[
  {
    "id": "jack-mcbrayer",
    "name": "Jack McBrayer",
    "professions": ["actor", "comedian"],
    "origin": "comedy-peer",
    "friendshipScore": 96,
    "friendshipLabel": "Inner Circle",
    "appearances": 12,
    "eras": ["late-night-nbc", "tonight-show", "tbs-conan", "podcast"],
    "firstAppearance": "2006-11-01",
    "lastAppearance": "2024-03-15",
    "scoreBreakdown": {
      "appearances": 30,
      "coldOpenSentiment": 25,
      "originDepth": 16,
      "visitType": 15,
      "gapResilience": 10
    }
  }
]
```

**Build script snippet** — add to your existing `scripts/` pipeline or as a standalone
`scripts/emit_context.ts`:

```typescript
import guests from '../data/guests.json';
import fs from 'fs';

const context = guests.guests.map(g => ({
  id: g.id,
  name: g.name,
  professions: g.bio?.profession ?? [],
  origin: g.origin?.type ?? 'unknown',
  friendshipScore: g.friendshipScore,
  friendshipLabel: g.friendshipLabel,
  appearances: g.appearances?.length ?? 0,
  eras: [...new Set(g.appearances?.map((a: any) => a.era) ?? [])],
  firstAppearance: g.appearances?.[0]?.date ?? '',
  lastAppearance: g.appearances?.[g.appearances.length - 1]?.date ?? '',
  scoreBreakdown: g.scoreBreakdown,
}));

fs.writeFileSync('api/guests_context.json', JSON.stringify(context, null, 2));
console.log(`Wrote ${context.length} guests to api/guests_context.json`);
```

Run: `npx tsx scripts/emit_context.ts`

Commit `api/guests_context.json` — Vercel serves committed files, there's no build step.

---

## Step 3 — Create `api/ask.py`

Vercel Python serverless function. Copy this file verbatim, then fill in
`_NOTION_DB_ID` with your new database ID from Step 1.

```python
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
_NOTION_DB_ID      = 'YOUR_DATABASE_ID_HERE'   # ← paste from Step 1
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
    token = os.environ.get('NOTION_TOKEN') or os.environ.get('NotionCONAFmap', '')
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

SYSTEM_TEMPLATE = """You are the Q&A assistant for the CONAF Friend Registry — \
a fan-made archive of every friendship Conan O'Brien has formed across 30+ years \
of television and podcasting.

== PRE-COMPUTED STATS (use these for count/ranking questions — do NOT recompute from the list) ==
{stats}

== GUEST LIST (one line per guest) ==
name | professions | origin | friendshipScore | friendshipLabel | appearances | eras | first | last
{table}

Rules:
- Answer questions about these guests and their relationship with Conan only.
- Decline off-topic questions politely.
- Be concise and friendly — 1–4 sentences or a short list. This shows on a fan website.
- For COUNT or RANKING questions: read numbers directly from PRE-COMPUTED STATS. State once, confidently.
- For NAME/DETAIL questions: look up the guest in the list and answer directly.
- Always give a complete answer. Never end with "Would you like me to..." — include everything in one response.
- Do not invent guests or details not in the data."""


def _load_guests():
    with open(CONTEXT_FILE, encoding='utf-8') as f:
        return json.load(f)


def _build_stats(guests):
    from collections import Counter
    total = len(guests)
    label_counts  = Counter(g['friendshipLabel'] for g in guests if g.get('friendshipLabel'))
    origin_counts = Counter(g['origin']          for g in guests if g.get('origin'))
    prof_counts   = Counter(p for g in guests for p in g.get('professions', []))
    era_counts    = Counter(e for g in guests for e in g.get('eras', []))
    top10 = sorted(guests, key=lambda g: g.get('friendshipScore', 0), reverse=True)[:10]
    lines = [
        f"Total guests: {total}",
        "",
        "Guests by friendship label:",
    ]
    for label, count in label_counts.most_common():
        lines.append(f"  {label}: {count}")
    lines += ["", "Guests by origin type:"]
    for origin, count in origin_counts.most_common():
        lines.append(f"  {origin}: {count}")
    lines += ["", "Top 10 by friendship score:"]
    for g in top10:
        lines.append(f"  {g['name']}: {g.get('friendshipScore')} ({g.get('friendshipLabel')})")
    lines += ["", "Top professions:"]
    for prof, count in prof_counts.most_common(10):
        lines.append(f"  {prof}: {count}")
    lines += ["", "Appearances by era:"]
    era_labels = {
        'late-night-nbc': 'Late Night NBC (1993–2009)',
        'tonight-show':   'Tonight Show (2009–2010)',
        'tbs-conan':      'Conan TBS (2010–2021)',
        'podcast':        'Podcast (2018–present)',
        'must-go':        'Conan Must Go (2023–present)',
    }
    for era, count in era_counts.most_common():
        lines.append(f"  {era_labels.get(era, era)}: {count} guests")
    return '\n'.join(lines)


def _build_system_prompt(guests):
    stats = _build_stats(guests)
    lines = []
    for g in guests:
        eras = ', '.join(g.get('eras', []))
        profs = ', '.join(g.get('professions', []))
        lines.append(
            f"{g['name']} | {profs} | {g.get('origin','')} | "
            f"{g.get('friendshipScore','')} | {g.get('friendshipLabel','')} | "
            f"{g.get('appearances','')} apps | {eras} | "
            f"{g.get('firstAppearance','')} → {g.get('lastAppearance','')}"
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
                   or os.environ.get('Anthropic_API', ''))
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
```

---

## Step 4 — Create `api/requirements.txt`

```
anthropic
```

---

## Step 5 — Update `vercel.json`

If `vercel.json` doesn't exist yet, create it. If it does, merge the `functions` block:

```json
{
  "functions": {
    "api/ask.py": {
      "memory": 256,
      "maxDuration": 15,
      "includeFiles": "api/guests_context.json"
    }
  }
}
```

`includeFiles` is critical — it tells Vercel to bundle `guests_context.json` into the
function's deployment package. Without it, the file won't be readable at runtime.

---

## Step 6 — Frontend: HTML + JS + CSS

### HTML (add wherever you want the Q&A section)

```html
<section class="ask-section" id="askSection">
  <div class="ask-inner">
    <h2>Ask the Registry</h2>
    <p class="ask-sub">Ask anything about Conan's guests and their friendship scores.</p>
    <form class="ask-form" id="askForm" autocomplete="off">
      <input id="askInput" type="text" placeholder="Who has the highest friendship score?" maxlength="500" />
      <button type="submit" id="askBtn">Ask</button>
    </form>
    <div id="askSuggestions" class="ask-suggestions">
      <button class="ask-chip" type="button">Who are Conan's Inner Circle friends?</button>
      <button class="ask-chip" type="button">Which guest has appeared the most?</button>
      <button class="ask-chip" type="button">Who was Conan's first NBC guest?</button>
    </div>
    <div id="askAnswerWrap" class="ask-answer-wrap" hidden>
      <div id="askAnswer" class="ask-answer"></div>
      <div class="ask-share-row">
        <button id="askCopyBtn" class="ask-share-btn">📋 Copy</button>
        <button id="askShareBtn" class="ask-share-btn">↗ Share</button>
      </div>
    </div>
  </div>
</section>
```

### JavaScript (`src/ask.js` or inline `<script>`)

```javascript
(function () {
  const form     = document.getElementById('askForm');
  const input    = document.getElementById('askInput');
  const btn      = document.getElementById('askBtn');
  const answerEl = document.getElementById('askAnswer');
  const wrapEl   = document.getElementById('askAnswerWrap');
  const shareBtn = document.getElementById('askShareBtn');
  const chips    = document.getElementById('askSuggestions');
  if (!form || !input || !answerEl) return;

  let busy = false, lastQuestion = '', lastAnswerText = '';

  function mdToHtml(text) {
    const esc = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const lines = esc.split('\n');
    const out = []; let inList = false;
    for (const raw of lines) {
      const line = raw.trim();
      const bullet = line.match(/^[-*]\s+(.+)/);
      const num    = line.match(/^\d+\.\s+(.+)/);
      if (bullet || num) {
        if (!inList) { out.push(bullet ? '<ul>' : '<ol>'); inList = bullet ? 'ul' : 'ol'; }
        out.push('<li>' + applyInline(bullet ? bullet[1] : num[1]) + '</li>');
      } else {
        if (inList) { out.push('</' + inList + '>'); inList = false; }
        if (line) out.push('<p>' + applyInline(line) + '</p>');
      }
    }
    if (inList) out.push('</' + inList + '>');
    return out.join('');
  }

  function applyInline(s) {
    return s.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>');
  }

  function show(text, kind) {
    wrapEl.hidden = false;
    answerEl.className = 'ask-answer' + (kind ? ' ask-answer--' + kind : '');
    answerEl[kind === 'error' || kind === 'loading' ? 'textContent' : 'innerHTML'] =
      kind === 'error' || kind === 'loading' ? text : mdToHtml(text);
    shareBtn.hidden = kind === 'loading' || kind === 'error';
  }

  async function ask(question) {
    question = (question || '').trim();
    if (!question || busy) return;
    busy = true; btn.disabled = true; input.disabled = true;
    show('Thinking…', 'loading');
    try {
      const res  = await fetch('/api/ask', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.answer) {
        lastQuestion = question; lastAnswerText = data.answer;
        show(data.answer, null);
      } else {
        show(data.error ? 'Sorry — ' + data.error + '.' : 'Sorry, something went wrong.', 'error');
      }
    } catch (e) {
      show('Could not reach the server. Check your connection and try again.', 'error');
    } finally {
      busy = false; btn.disabled = false; input.disabled = false; input.focus();
    }
  }

  form.addEventListener('submit', e => { e.preventDefault(); ask(input.value); });
  chips?.addEventListener('click', e => {
    const chip = e.target.closest('.ask-chip');
    if (chip) { input.value = chip.textContent; ask(chip.textContent); }
  });

  function shareText() {
    return '"' + lastQuestion + '"\n\n' + lastAnswerText + '\n\nMore at [YOUR SITE URL]';
  }

  document.getElementById('askCopyBtn')?.addEventListener('click', function () {
    navigator.clipboard.writeText(shareText()).then(() => {
      const orig = this.innerHTML; this.textContent = 'Copied!';
      setTimeout(() => this.innerHTML = orig, 2000);
    }).catch(() => {});
  });

  shareBtn?.addEventListener('click', function () {
    if (navigator.share) {
      navigator.share({ title: 'Friend Registry', text: shareText() }).catch(() => {});
    } else {
      navigator.clipboard.writeText(shareText()).then(() => {
        const orig = this.innerHTML; this.textContent = 'Copied!';
        setTimeout(() => this.innerHTML = orig, 2000);
      }).catch(() => {});
    }
  });
})();
```

### CSS (adapt colors to the Friend Registry theme)

```css
.ask-section { padding: 40px 24px; border-top: 1px solid var(--border); }
.ask-inner   { width: 100%; }
.ask-form    { display: flex; gap: 10px; max-width: min(620px, 100%); margin-top: 16px; }
.ask-form input  { flex: 1; min-width: 0; padding: 12px 16px; border: 1px solid var(--border);
                   border-radius: 8px; background: var(--bg2); color: var(--text); font-size: 15px; }
.ask-form button { padding: 0 20px; height: 46px; border-radius: 8px; border: none;
                   background: var(--accent); color: #fff; font-weight: 600; cursor: pointer;
                   white-space: nowrap; flex-shrink: 0; }
.ask-suggestions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px;
                   max-width: min(620px, 100%); }
.ask-chip   { padding: 6px 14px; border: 1px solid var(--border); border-radius: 20px;
              background: none; color: var(--text-muted); font-size: 13px; cursor: pointer; }
.ask-chip:hover { border-color: var(--accent); color: var(--accent); }
.ask-answer-wrap { max-width: min(620px, 100%); margin-top: 20px; }
.ask-answer { background: var(--bg2); border: 1px solid var(--border); border-radius: 10px;
              padding: 16px 20px; font-size: 15px; line-height: 1.6; text-align: left; }
.ask-answer p  { margin: 0 0 10px; } .ask-answer p:last-child { margin-bottom: 0; }
.ask-answer ul, .ask-answer ol { margin: 0 0 10px; padding-left: 20px; }
.ask-answer li { margin-bottom: 4px; }
.ask-share-row  { display: flex; gap: 10px; margin-top: 12px; }
.ask-share-btn  { display: inline-flex; align-items: center; gap: 6px; background: none;
                  border: 1px solid var(--border); border-radius: 8px; color: var(--text-muted);
                  padding: 6px 14px; font-size: 13px; cursor: pointer; }
.ask-share-btn:hover { border-color: var(--accent); color: var(--accent); }
```

---

## Step 7 — Vercel environment variables

In the Vercel dashboard for this project, add:

| Variable | Value |
|---|---|
| `Anthropic_API` | *(same key as conafmap project — copy from there)* |
| `NotionCONAFmap` | *(same Notion integration token — copy from conafmap project)* |

Both env vars go to **Production** and **Preview** environments.

---

## Step 8 — Deploy checklist

- [ ] `api/guests_context.json` committed (run emit script first)
- [ ] `api/ask.py` committed with correct `_NOTION_DB_ID`
- [ ] `api/requirements.txt` committed (`anthropic` on its own line)
- [ ] `vercel.json` has `functions` block with `includeFiles`
- [ ] Notion database created and shared with integration
- [ ] Both env vars set in Vercel dashboard
- [ ] Frontend HTML/JS/CSS added to site

---

## How it works (technical summary)

```
Browser → POST /api/ask {"question": "..."} (same-origin only)
  → api/ask.py (Vercel Python serverless, 256MB, 15s timeout)
    → reads api/guests_context.json (bundled at deploy)
    → builds system prompt with pre-computed stats + flat guest table
    → calls claude-haiku-4-5 (MAX_TOKENS=600, no streaming)
    → logs to Notion synchronously (before response — guarantees every row lands)
    → returns {"answer": "..."}
  → Browser renders markdown, shows Copy + Share buttons
```

**Why no RAG?** At ~3,000 guests the flat table fits in Haiku's context window comfortably.
If the guest list grows past ~8,000, consider chunking or switching to semantic search.

**Why synchronous logging?** Vercel kills background threads the moment the HTTP response
is sent. Logging before `return self._send(200, ...)` adds ~100ms but guarantees every
question lands in Notion.

**Why Haiku?** Fast (< 2s), cheap ($0.80/$4.00 per million tokens), and perfectly capable
for dataset Q&A at this scale. Upgrade to Sonnet if answer quality needs improvement.

---

## Suggested chip questions for the Friend Registry

```
Who are Conan's Inner Circle friends?
Which guest has appeared the most times?
Who was Conan's first Late Night guest?
Which actors have the highest friendship scores?
How many guests appeared across all five eras?
```

---

*Pattern source: conafmap.vercel.app — "Ask the Map" feature, built June 2026.*
*api/ask.py in CONAN_CallerMap is the canonical reference implementation.*
