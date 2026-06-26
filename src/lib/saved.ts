import { useEffect, useState, useCallback } from "react";

const KEY = "cineprint:saved";

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function useSaved() {
  const [saved, setSaved] = useState<string[]>([]);

  useEffect(() => {
    setSaved(read());
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setSaved(read());
    };
    const onCustom = () => setSaved(read());
    window.addEventListener("storage", onStorage);
    window.addEventListener("cineprint:saved-changed", onCustom);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("cineprint:saved-changed", onCustom);
    };
  }, []);

  const toggle = useCallback((id: string) => {
    const current = read();
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    localStorage.setItem(KEY, JSON.stringify(next));
    setSaved(next);
    window.dispatchEvent(new Event("cineprint:saved-changed"));
  }, []);

  return { saved, toggle, isSaved: (id: string) => saved.includes(id) };
}
