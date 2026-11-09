import { useEffect, useRef, useState, type ReactNode } from "react";
import { recordLink } from "./records";
import { BLANK, clock, count } from "./format";
import { RelatedLink } from "./related";
import { Glyph, glyph } from "./icons";
import { SkeletonTable } from "./load";
import { markBusy, RefreshButton } from "./refresh";
import { api } from "./api";

export type ListPayload<T> = {
  fetchedAt: string;
  tokenExpiresAt: string | null;
  source: string;
  rows: T[];
  hasMore: boolean;
  total: number | null;
  note?: string | null;
  page?: number;
};

export function useLive<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [tick, setTick] = useState(0);
  const pathRef = useRef(path);

  useEffect(() => {
    const onRefresh = (event: Event) => {
      const scope = (event as CustomEvent<{ scope?: string }>).detail?.scope;
      if (!path) return;
      if (!scope || scope === path) setTick((value) => value + 1);
    };
    window.addEventListener("hn-refresh", onRefresh);
    return () => window.removeEventListener("hn-refresh", onRefresh);
  }, [path]);

  useEffect(() => {
    if (!path) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    const pathChanged = pathRef.current !== path;
    pathRef.current = path;
    if (pathChanged) setData(null);
    const controller = new AbortController();
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      markBusy(false);
      if (!controller.signal.aborted) setLoading(false);
    };
    markBusy(true);
    setLoading(true);
    setError(null);
    api<T>(path, { signal: controller.signal, signInOn401: true })
      .then(setData)
      .catch((reason: Error) => {
        if (reason.name === "AbortError") return;
        setError(reason.message);
      })
      .finally(done);
    return () => {
      controller.abort();
      done();
    };
  }, [path, tick]);

  return { data, error, loading };
}

export function useDebounced(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function ListFrame({
  title,
  viewName,
  status,
  error,
  loading,
  ready,
  search,
  onSearch,
  placeholder,
  scope,
  tools,
  bar,
  children,
}: {
  title: string;
  viewName: string;
  status: string;
  error: string | null;
  loading: boolean;
  ready: boolean;
  search: string;
  onSearch: (value: string) => void;
  placeholder: string;
  scope: string;
  tools?: ReactNode;
  bar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <header className="page-head">
        <div>
          <div className="kicker">List view</div>
          <h1>{title}</h1>
        </div>
        <div className="page-tools">
          <p className="status">{status}</p>
          {tools}
          <RefreshButton label={title} scope={scope} busy={loading && ready} />
        </div>
      </header>
      {error && <p className="error">{explain(error)}</p>}
      <section className={loading && ready ? "list-view is-loading" : "list-view"}>
        <div className="list-bar">
          <strong>{viewName}</strong>
          {bar}
          <label className="search-field">
            <Glyph icon={glyph.search} size={14} />
            <input
              className="search"
              type="search"
              value={search}
              placeholder={placeholder}
              aria-label={`Search ${title.toLowerCase()}`}
              onChange={(event) => onSearch(event.target.value)}
            />
          </label>
        </div>
        {loading && !ready ? <SkeletonTable /> : children}
      </section>
    </>
  );
}

export function StatusPill({ value }: { value: string }) {
  const text = value || BLANK;
  const tone = /closed|expired|cancel|void|no/i.test(text) ? "warn" : /billed|paid|open|yes|active|pending/i.test(text) ? "ok" : "";
  return <span className={tone ? `pill ${tone}` : "pill"}>{text}</span>;
}

export function listStatus<T>(payload: { data: ListPayload<T> | null; loading: boolean }) {
  if (!payload.data) return "";
  const shown = payload.data.rows.length;
  const total = payload.data.total;
  const first = (payload.data.page || 0) * PAGE_SIZE;
  const rows = first && shown ? `rows ${count(first + 1)} to ${count(first + shown)}` : count(shown);
  const range = total != null ? `Showing ${rows} of ${count(total)}` : `Showing ${rows}`;
  const updating = payload.loading ? " · updating" : "";
  return `${range}${updating} · as of ${clock(payload.data.fetchedAt)}`;
}

export const PAGE_SIZE = 100;

export function Pager({ page, hasMore, onPage }: { page: number; hasMore: boolean; onPage: (page: number) => void }) {
  if (page === 0 && !hasMore) return null;
  return (
    <div className="actions">
      <button className="quiet" type="button" disabled={page === 0} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <span className="status">Page {page + 1}</span>
      <button className="quiet" type="button" disabled={!hasMore} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </div>
  );
}

export function explain(message: string) {
  if (/Concurrent request limit/i.test(message)) {
    return "NetSuite paused this request. This integration can only run a few SuiteQL calls at once. Open the page again.";
  }
  if (/REST Web Services' feature is not enabled/i.test(message)) {
    return "SuiteQL is off for this account. Turn on REST Web Services under Setup > Company > Enable Features > SuiteCloud.";
  }
  const missing = /Record '([^']+)' was not found/i.exec(message);
  if (missing) {
    return `This role cannot see ${missing[1]}. Add View for that record on the role, then reload.`;
  }
  return message;
}

export function RecordActions({
  kind,
  id,
  title,
  href,
  recordType,
}: {
  kind: "customer" | "transaction" | "item" | "employee" | "vendor";
  id: string;
  title: string;
  href: string;
  recordType?: string;
}) {
  return (
    <div className="row-actions">
      {kind !== "vendor" && <RelatedLink kind={kind} id={id} title={title} />}
      {recordType && (
        <a href={recordLink(recordType, id)} aria-label={`Open ${title} in Records`}>
          Records
        </a>
      )}
      <NetSuiteLink href={href} label={title} />
    </div>
  );
}

function NetSuiteLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" aria-label={`Open ${label} in NetSuite`}>
      <Glyph icon={glyph.external} size={14} />
      Open
    </a>
  );
}
