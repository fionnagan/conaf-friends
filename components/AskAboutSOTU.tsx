"use client";

import { useState, useRef } from "react";

const CHIPS = [
  "How has Conan's stance on video changed over time?",
  "What metrics has Adam Sachs shared about the show?",
  "What was the 2023 State of the Podcast about?",
  "Has the show won any press recognition?",
];

function mdToHtml(text: string): string {
  const esc = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const lines = esc.split("\n");
  const out: string[] = [];
  let inList: "ul" | "ol" | false = false;
  for (const raw of lines) {
    const line = raw.trim();
    const bullet = line.match(/^[-*]\s+(.+)/);
    const num = line.match(/^\d+\.\s+(.+)/);
    if (bullet || num) {
      if (!inList) {
        out.push(bullet ? "<ul>" : "<ol>");
        inList = bullet ? "ul" : "ol";
      }
      out.push("<li>" + applyInline(bullet ? bullet[1] : num![1]) + "</li>");
    } else {
      if (inList) {
        out.push("</" + inList + ">");
        inList = false;
      }
      if (line) out.push("<p>" + applyInline(line) + "</p>");
    }
  }
  if (inList) out.push("</" + inList + ">");
  return out.join("");
}

function applyInline(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
}

export default function AskAboutSOTU() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [answerKind, setAnswerKind] = useState<"ok" | "error" | "loading" | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function show(text: string, kind: "ok" | "error" | "loading") {
    setAnswer(text);
    setAnswerKind(kind);
  }

  async function ask(q: string) {
    q = q.trim();
    if (!q || busy) return;
    setBusy(true);
    show("Thinking…", "loading");
    try {
      const res = await fetch("/api/ask_sotu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.answer) {
        show(data.answer, "ok");
      } else {
        show(data.error ? "Sorry — " + data.error + "." : "Sorry, something went wrong.", "error");
      }
    } catch {
      show("Could not reach the server. Check your connection and try again.", "error");
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="mb-10 pb-10 border-b border-[var(--border)]">
      <h2 className="font-serif text-2xl font-semibold mb-1">
        Ask About the State of the Podcast
      </h2>
      <p className="text-sm text-[var(--text-muted)] mb-4">
        Scoped only to these segments — not general guest questions. For that, use the
        main Ask the Registry box on other pages.
      </p>

      <form
        onSubmit={(e) => { e.preventDefault(); ask(question); }}
        className="flex gap-2 max-w-[620px]"
        autoComplete="off"
      >
        <input
          ref={inputRef}
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="How has Conan's stance on video changed over time?"
          maxLength={500}
          disabled={busy}
          className="flex-1 min-w-0 px-4 py-3 rounded-xl bg-[var(--bg2)] border border-[var(--border)] text-[var(--text)] placeholder-[var(--text-muted)] text-sm focus:outline-none focus:border-[var(--teal)] transition-colors disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={busy || !question.trim()}
          className="px-5 py-3 rounded-xl bg-[var(--teal)] text-white text-sm font-semibold whitespace-nowrap flex-shrink-0 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          Ask
        </button>
      </form>

      <div className="flex flex-wrap gap-2 mt-3 max-w-[620px]">
        {CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => { setQuestion(chip); ask(chip); }}
            className="px-3 py-1.5 rounded-full border border-[var(--border)] bg-transparent text-[var(--text-muted)] text-xs hover:border-[var(--teal)] hover:text-[var(--teal)] transition-colors"
          >
            {chip}
          </button>
        ))}
      </div>

      {answerKind && (
        <div className="max-w-[620px] mt-5">
          <div
            className={`bg-[var(--bg2)] border border-[var(--border)] rounded-xl px-5 py-4 text-sm leading-relaxed text-left ${
              answerKind === "error" ? "text-red-400" : answerKind === "loading" ? "text-[var(--text-muted)] italic" : "text-[var(--text)]"
            }`}
            {...(answerKind === "ok"
              ? { dangerouslySetInnerHTML: { __html: mdToHtml(answer) } }
              : { children: answer }
            )}
          />
        </div>
      )}
    </div>
  );
}
