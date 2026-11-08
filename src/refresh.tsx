import { useEffect, useState } from "react";
import { Glyph, glyph } from "./icons";
import { Pick } from "./pick";

export const refreshIntervals = [
  { id: "off", label: "Off", ms: 0 },
  { id: "30s", label: "30 seconds", ms: 30_000 },
  { id: "1m", label: "1 minute", ms: 60_000 },
  { id: "5m", label: "5 minutes", ms: 300_000 },
  { id: "15m", label: "15 minutes", ms: 900_000 },
] as const;

export type RefreshId = (typeof refreshIntervals)[number]["id"];

const storageKey = "hn-refresh";

export function readRefresh(): RefreshId {
  const stored = localStorage.getItem(storageKey);
  return refreshIntervals.some((item) => item.id === stored) ? (stored as RefreshId) : "off";
}

export function refreshMs(id: RefreshId = readRefresh()) {
  return refreshIntervals.find((item) => item.id === id)?.ms ?? 0;
}

export function useRefreshInterval() {
  const [id, setId] = useState<RefreshId>(readRefresh);

  useEffect(() => {
    const onChange = (event: Event) => {
      const next = (event as CustomEvent<RefreshId>).detail;
      if (refreshIntervals.some((item) => item.id === next)) setId(next);
    };
    window.addEventListener("hn-refresh-interval", onChange);
    return () => window.removeEventListener("hn-refresh-interval", onChange);
  }, []);

  function choose(next: RefreshId) {
    setId(next);
    localStorage.setItem(storageKey, next);
    window.dispatchEvent(new CustomEvent<RefreshId>("hn-refresh-interval", { detail: next }));
  }

  return [id, choose] as const;
}

type RefreshDetail = { scope?: string };

export function refreshAll() {
  window.dispatchEvent(new CustomEvent<RefreshDetail>("hn-refresh", { detail: {} }));
}

export function refreshScope(scope: string) {
  window.dispatchEvent(new CustomEvent<RefreshDetail>("hn-refresh", { detail: { scope } }));
}

export function useRefreshTick(scope: string) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const onRefresh = (event: Event) => {
      const next = (event as CustomEvent<RefreshDetail>).detail?.scope;
      if (!next || next === scope) setTick((value) => value + 1);
    };
    window.addEventListener("hn-refresh", onRefresh);
    return () => window.removeEventListener("hn-refresh", onRefresh);
  }, [scope]);
  return tick;
}

let busy = 0;
const busyListeners = new Set<() => void>();

export function markBusy(active: boolean) {
  busy = Math.max(0, busy + (active ? 1 : -1));
  busyListeners.forEach((listener) => listener());
}

export function useRefreshBusy() {
  const [count, setCount] = useState(busy);
  useEffect(() => {
    const listener = () => setCount(busy);
    busyListeners.add(listener);
    return () => {
      busyListeners.delete(listener);
    };
  }, []);
  return count > 0;
}

export function RefreshButton({
  label,
  scope,
  busy: spinning = false,
  onClick,
}: {
  label: string;
  scope?: string;
  busy?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      className="quiet icon-btn"
      type="button"
      aria-label={`Refresh ${label}`}
      onClick={(event) => {
        event.stopPropagation();
        if (onClick) onClick();
        else if (scope) refreshScope(scope);
      }}
    >
      <span className={spinning ? "spin" : undefined}>
        <Glyph icon={glyph.refresh} />
      </span>
    </button>
  );
}

export function RefreshIntervalSelect() {
  const [interval, setInterval] = useRefreshInterval();
  return (
    <label className="theme-pick">
      Interval
      <Pick
        label="Refresh interval"
        value={interval}
        onChange={(next) => setInterval(next as RefreshId)}
        options={refreshIntervals.map((item) => ({ value: item.id, label: item.label }))}
      />
    </label>
  );
}
