"use client";

import { useState, useRef, useEffect, useCallback, KeyboardEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { COUNTRIES } from "@/lib/countries";
import { countryFlag } from "@/lib/country-flags";

interface Props {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}

export default function CountryCombobox({ value, onChange, disabled }: Props) {
  const [query, setQuery]     = useState(value);
  const [open, setOpen]       = useState(false);
  const [cursor, setCursor]   = useState(-1);
  const inputRef              = useRef<HTMLInputElement>(null);
  const listRef               = useRef<HTMLUListElement>(null);

  const filtered = query.length === 0
    ? COUNTRIES
    : COUNTRIES.filter((c) => c.toLowerCase().includes(query.toLowerCase()));

  // Sync display value when parent resets
  useEffect(() => { if (!open) setQuery(value); }, [value, open]);

  const select = useCallback((country: string) => {
    onChange(country);
    setQuery(country);
    setOpen(false);
    setCursor(-1);
  }, [onChange]);

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) { setOpen(true); return; }
    if (e.key === "Escape") { setOpen(false); setCursor(-1); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, -1));
    } else if (e.key === "Enter" && cursor >= 0) {
      e.preventDefault();
      select(filtered[cursor]);
    }
  };

  // Scroll selected item into view
  useEffect(() => {
    if (cursor >= 0 && listRef.current) {
      const item = listRef.current.children[cursor] as HTMLElement | undefined;
      item?.scrollIntoView({ block: "nearest" });
    }
  }, [cursor]);

  const isMatch = COUNTRIES.includes(query);

  return (
    <div className="relative">
      <div className="relative">
        {/* flag display */}
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg pointer-events-none select-none">
          {isMatch ? countryFlag(query) : "🌐"}
        </span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          disabled={disabled}
          placeholder="Search your country…"
          autoComplete="off"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setCursor(-1);
            if (!COUNTRIES.includes(e.target.value)) onChange("");
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={handleKey}
          className="w-full pl-11 pr-4 py-3 rounded-xl bg-[var(--bg2)] border border-[var(--border)] text-[var(--text)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--orange)] transition-colors"
        />
        {isMatch && (
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--orange)] text-sm pointer-events-none">✓</span>
        )}
      </div>

      <AnimatePresence>
        {open && filtered.length > 0 && (
          <motion.ul
            ref={listRef}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute z-50 left-0 right-0 mt-1.5 max-h-56 overflow-y-auto rounded-xl bg-[var(--bg2)] border border-[var(--border)] shadow-2xl"
            style={{ scrollbarWidth: "thin" }}
          >
            {filtered.map((c, i) => (
              <li
                key={c}
                onMouseDown={() => select(c)}
                onMouseEnter={() => setCursor(i)}
                className={`flex items-center gap-3 px-4 py-2.5 text-sm cursor-pointer transition-colors ${
                  i === cursor
                    ? "bg-[var(--orange)] text-white"
                    : "text-[var(--text)] hover:bg-white/5"
                }`}
              >
                <span className="text-base">{countryFlag(c)}</span>
                <span>{c}</span>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
