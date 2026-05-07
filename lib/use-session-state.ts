"use client";
import { useCallback, useState } from "react";

const KEY = "i-feel-state-v1";

interface PersistedState {
  name: string;
  country: string;
  feeling: string;
  results: unknown | null;
  pngUrl: string | null;
}

function read(): Partial<PersistedState> {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function write(state: PersistedState) {
  try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch {}
}

export function useSessionState() {
  const saved = read();

  const [name,    setNameRaw]    = useState(saved.name    ?? "");
  const [country, setCountryRaw] = useState(saved.country ?? "");
  const [feeling, setFeelingRaw] = useState(saved.feeling ?? "");
  const [results, setResultsRaw] = useState<unknown | null>(saved.results ?? null);
  const [pngUrl,  setPngUrlRaw]  = useState<string | null>(saved.pngUrl ?? null);

  // Wrap setters to also persist
  const persist = useCallback((patch: Partial<PersistedState>) => {
    const current = read();
    write({ ...current, ...patch } as PersistedState);
  }, []);

  const setName    = useCallback((v: string)       => { setNameRaw(v);    persist({ name: v }); }, [persist]);
  const setCountry = useCallback((v: string)       => { setCountryRaw(v); persist({ country: v }); }, [persist]);
  const setFeeling = useCallback((v: string)       => { setFeelingRaw(v); persist({ feeling: v }); }, [persist]);
  const setResults = useCallback((v: unknown|null) => { setResultsRaw(v); persist({ results: v }); }, [persist]);
  const setPngUrl  = useCallback((v: string|null)  => { setPngUrlRaw(v);  persist({ pngUrl: v }); }, [persist]);

  return { name, setName, country, setCountry, feeling, setFeeling, results, setResults, pngUrl, setPngUrl };
}
