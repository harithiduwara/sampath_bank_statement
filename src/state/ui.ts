import { useCallback, useEffect, useState } from "react";

export type ViewId = "overview" | "ledger" | "reconciliation" | "reports" | "statements";
export const VIEWS: ViewId[] = ["overview", "ledger", "reconciliation", "reports", "statements"];

const readHash = (): { view: ViewId; params: URLSearchParams } => {
  const [path, query = ""] = window.location.hash.replace(/^#\/?/, "").split("?");
  const view = (VIEWS as string[]).includes(path) ? (path as ViewId) : "overview";
  return { view, params: new URLSearchParams(query) };
};

/** Hash routing: views are linkable and the browser back button works. */
export function useRoute() {
  const [route, setRoute] = useState(readHash);
  useEffect(() => {
    const on = () => setRoute(readHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = useCallback((view: ViewId, params?: Record<string, string>) => {
    const q = params ? `?${new URLSearchParams(params)}` : "";
    window.location.hash = `/${view}${q}`;
  }, []);
  return { ...route, go };
}

export type ThemePref = "system" | "light" | "dark";
const THEME_KEY = "statement-studio:theme";

/** The theme is the only thing kept in browser storage (a display preference, no statement data). */
export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(() => {
    try {
      const v = localStorage.getItem(THEME_KEY);
      return v === "light" || v === "dark" ? v : "system";
    } catch {
      return "system";
    }
  });
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (pref === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", pref);
    try {
      if (pref === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, pref);
    } catch {
      /* storage blocked: the choice simply isn't remembered */
    }
  }, [pref]);

  const resolved: "light" | "dark" = pref === "system" ? (systemDark ? "dark" : "light") : pref;
  return { pref, setPref, resolved };
}
