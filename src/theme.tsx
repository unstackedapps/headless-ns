import { useEffect, useState } from "react";
import { Pick } from "./pick";

export const themes = [
  { id: "ledger", label: "Ledger", tone: "light", panel: "#ffffff", accent: "#1f4e79" },
  { id: "paper", label: "Paper", tone: "light", panel: "#fffdf8", accent: "#1f4e79" },
  { id: "day", label: "Day", tone: "light", panel: "#f7f8fa", accent: "#153a5c" },
  { id: "ink", label: "Ink", tone: "dark", panel: "#1c2229", accent: "#8eb4d8" },
  { id: "graphite", label: "Graphite", tone: "dark", panel: "#242424", accent: "#d6d6d6" },
  { id: "night", label: "Night", tone: "dark", panel: "#162033", accent: "#7eb0e0" },
] as const;

export type ThemeId = (typeof themes)[number]["id"];

const key = "hn-theme";

export function readTheme(): ThemeId {
  const stored = localStorage.getItem(key);
  return themes.some((theme) => theme.id === stored) ? (stored as ThemeId) : "ledger";
}

export function applyTheme(id: ThemeId) {
  document.documentElement.dataset.theme = id;
  document.documentElement.style.colorScheme = themes.find((theme) => theme.id === id)?.tone || "light";
  localStorage.setItem(key, id);
}

export function applyStoredTheme() {
  applyTheme(readTheme());
  applyShape(readShape());
}

export type ShapeId = "square" | "round";

const shapeKey = "hn-shape";

export function readShape(): ShapeId {
  return localStorage.getItem(shapeKey) === "round" ? "round" : "square";
}

export function applyShape(shape: ShapeId) {
  document.documentElement.dataset.shape = shape;
  localStorage.setItem(shapeKey, shape);
}

export function useShape() {
  const [shape, setShape] = useState<ShapeId>(readShape);

  useEffect(() => {
    applyShape(shape);
  }, [shape]);

  useEffect(() => {
    const onShape = (event: Event) => {
      const next = (event as CustomEvent<ShapeId>).detail;
      if (next === "square" || next === "round") setShape(next);
    };
    window.addEventListener("hn-shape", onShape);
    return () => window.removeEventListener("hn-shape", onShape);
  }, []);

  function choose(next: ShapeId) {
    setShape(next);
    window.dispatchEvent(new CustomEvent<ShapeId>("hn-shape", { detail: next }));
  }

  return [shape, choose] as const;
}

export function ShapeSelect({ labelled = false }: { labelled?: boolean }) {
  const [shape, setShape] = useShape();
  return (
    <label className="theme-pick">
      {labelled ? "Corners" : <span className="sr">Corners</span>}
      <Pick
        label="Corners"
        value={shape}
        onChange={(next) => setShape(next as ShapeId)}
        options={[
          { value: "square", label: "Square" },
          { value: "round", label: "Round" },
        ]}
      />
    </label>
  );
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemeId>(readTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const onTheme = (event: Event) => {
      const next = (event as CustomEvent<ThemeId>).detail;
      if (themes.some((item) => item.id === next)) setTheme(next);
    };
    window.addEventListener("hn-theme", onTheme);
    return () => window.removeEventListener("hn-theme", onTheme);
  }, []);

  function choose(next: ThemeId) {
    setTheme(next);
    window.dispatchEvent(new CustomEvent<ThemeId>("hn-theme", { detail: next }));
  }

  return [theme, choose] as const;
}

export function ThemeSelect({ labelled = false }: { labelled?: boolean }) {
  const [theme, setTheme] = useTheme();
  return (
    <label className="theme-pick">
      {labelled ? "Theme" : <span className="sr">Theme</span>}
      <Pick
        label="Theme"
        value={theme}
        onChange={(next) => setTheme(next as ThemeId)}
        options={themes.map((item) => ({ value: item.id, label: item.label, group: item.tone === "light" ? "Light" : "Dark" }))}
      />
    </label>
  );
}
