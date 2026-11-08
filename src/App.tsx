import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { amount, clock, count, dateLabel } from "./format";
import { SeriesChart } from "./chart";
import { UserMenu } from "./account";
import { AskDrawer, CommandLine } from "./chrome";
import { ConnectionPanel } from "./connect";
import { FilesPage } from "./files";
import { RelatedHost, RelatedLink } from "./related";
import { SearchesPage } from "./searches";
import { Glyph, glyph, navIcons } from "./icons";
import { Pick, Tip } from "./pick";
import { portletCatalog, useLayout, widthWord, type MeasureId, type PortletPref, type RangeId, type Span, type VisualId } from "./layout";
import { LoadingPage, Lookup, SkeletonPortlets, SkeletonRecord, SkeletonTable } from "./load";
import { markBusy, refreshAll, refreshMs, refreshScope, RefreshButton, RefreshIntervalSelect, useRefreshBusy, useRefreshInterval } from "./refresh";
import { ReportsPage, SettingsPage, TracePage, WorkbenchPage } from "./studio";

type Discovery = {
  issuer: string;
  scopes: string[];
  signingKeys: number;
  jwksError: string | null;
  fetchedAt: string;
};

type SessionInfo = {
  configured: boolean;
  accountId: string;
  redirectUri: string;
  ephemeralSecret: boolean;
  discovery: Discovery | null;
  discoveryError: string | null;
  signedIn: boolean;
  via: "osmcp" | "opensuitemcp" | "custom" | "netsuite" | "oidc" | null;
  roleId: string | null;
  email: string | null;
  expiresAt: string | null;
  osmcpError: string | null;
};

type MoneyRow = {
  currency: string;
  n: number;
  amount: number | null;
  avg: number | null;
  min: number | null;
  max: number | null;
};
type Metric = { n?: number; rows?: MoneyRow[]; error?: string };
type Overview = {
  fetchedAt: string;
  tokenExpiresAt: string | null;
  source: string;
  year: number;
  metrics: Record<string, Metric>;
};
type Activity = { year: number; rows: { type: string; n: number }[] };
type ListPayload<T> = {
  fetchedAt: string;
  tokenExpiresAt: string | null;
  source: string;
  rows: T[];
  hasMore: boolean;
  total: number | null;
  note?: string | null;
};

type Customer = {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  subsidiary: string;
  href: string;
};
type Order = {
  id: string;
  number: string;
  date: string;
  customer: string;
  status: string;
  currency: string;
  amount: number | null;
  href: string;
};
type Bill = {
  id: string;
  number: string;
  date: string;
  due: string;
  name: string;
  currency: string;
  amount: number | null;
  unpaid: number | null;
  href: string;
};
type Item = {
  id: string;
  name: string;
  displayName: string;
  onHand: number | null;
  available: number | null;
  href: string;
};
type AccountOrder = {
  id: string;
  number: string;
  date: string;
  status: string;
  currency: string;
  amount: number | null;
  href: string;
};
type AccountInvoice = {
  id: string;
  number: string;
  due: string;
  currency: string;
  unpaid: number | null;
  href: string;
};
type CustomerFile = {
  fetchedAt: string;
  customer: Customer;
  balance: { currency: string; amount: number | null }[];
  orders: AccountOrder[];
  invoices: AccountInvoice[];
};
type Person = {
  id: string;
  name: string;
  title: string;
  email: string;
  hireDate: string;
  subsidiary: string;
  salesRep: string;
  href: string;
};

const ledgerViews = [
  ["overview", "Overview"],
  ["customers", "Customers"],
  ["orders", "Orders"],
  ["quotes", "Quotes"],
  ["invoices", "Invoices"],
  ["bills", "Bills"],
  ["items", "Items"],
  ["people", "People"],
  ["searches", "Searches"],
  ["files", "Files"],
] as const;

const studioViews = [
  ["reports", "Reports"],
  ["workbench", "Workbench"],
  ["trace", "Trace"],
  ["settings", "Settings"],
] as const;

const views = [...ledgerViews, ...studioViews];

type ViewId = (typeof views)[number][0];

const typeLabels: Record<string, string> = {
  CustInvc: "Invoice",
  SalesOrd: "Sales order",
  CashSale: "Cash sale",
  CustCred: "Credit memo",
  CustPymt: "Customer payment",
  VendBill: "Vendor bill",
  VendPymt: "Vendor payment",
  VendCred: "Vendor credit",
  ItemShip: "Item fulfillment",
  ItemRcpt: "Item receipt",
  Journal: "Journal",
  CustRfnd: "Customer refund",
  Deposit: "Deposit",
  DepAppl: "Deposit application",
  PurchOrd: "Purchase order",
  TrnfrOrd: "Transfer order",
  RtnAuth: "Return authorization",
  InvAdjst: "Inventory adjustment",
  InvTrnfr: "Inventory transfer",
  ExpRept: "Expense report",
  Check: "Check",
  Estimate: "Estimate",
};

function hashName() {
  return location.hash.replace(/^#\/?/, "");
}

function currentView(): ViewId {
  const name = hashName();
  if (name === "ask") return "overview";
  return views.some(([id]) => id === name) ? (name as ViewId) : "overview";
}

async function readJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) {
    location.href = "/api/auth/login";
    throw new Error("Sign in with NetSuite.");
  }
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body as T;
}

function useLive<T>(path: string | null) {
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
    fetch(path, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (response.status === 401) {
          location.href = "/api/auth/login";
          return;
        }
        if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
        setData(body as T);
      })
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

function useDebounced(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function authErrorFromUrl() {
  return new URLSearchParams(location.search).get("auth_error");
}

function SideNav({ view }: { view: ViewId }) {
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem("hn-nav-w"));
    return saved >= 168 && saved <= 480 ? saved : 212;
  });
  const [open, setOpen] = useState(() => localStorage.getItem("hn-nav-open") !== "0");
  const [dragging, setDragging] = useState(false);
  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 860px)").matches);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 860px)");
    const onChange = () => setNarrow(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  function toggle() {
    setOpen((value) => {
      localStorage.setItem("hn-nav-open", value ? "0" : "1");
      return !value;
    });
  }

  function resizeTo(next: number) {
    const clamped = Math.min(480, Math.max(168, next));
    setWidth(clamped);
    localStorage.setItem("hn-nav-w", String(clamped));
  }

  function startResize(event: ReactPointerEvent) {
    if (!open || narrow) return;
    const startX = event.clientX;
    const startW = width;
    setDragging(true);
    const move = (ev: PointerEvent) => resizeTo(startW + (ev.clientX - startX));
    const stop = () => {
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }

  return (
    <nav
      className={[open ? "" : "is-collapsed", dragging ? "is-dragging" : ""].filter(Boolean).join(" ")}
      style={!narrow && open ? { width } : undefined}
      aria-label="Sections"
    >
      <div className="nav-links">
        <span className="nav-label">Ledger</span>
        {ledgerViews.map(([id, label]) => (
          <Tip key={id} label={open ? "" : label} side="right">
            <a href={`#/${id}`} aria-current={view === id ? "page" : undefined} aria-label={label}>
              <Glyph icon={navIcons[id]} />
              <span className="nav-text">{label}</span>
            </a>
          </Tip>
        ))}
        <span className="nav-label">Studio</span>
        {studioViews.map(([id, label]) => (
          <Tip key={id} label={open ? "" : label} side="right">
            <a href={`#/${id}`} aria-current={view === id ? "page" : undefined} aria-label={label}>
              <Glyph icon={navIcons[id]} />
              <span className="nav-text">{label}</span>
            </a>
          </Tip>
        ))}
      </div>
      <div className="nav-tools">
        <Tip label={open ? "" : "Show menu"} side="right">
        <button className="quiet nav-toggle" type="button" aria-pressed={open} aria-label={open ? "Hide menu" : "Show menu"} onClick={toggle}>
          <Glyph icon={open ? glyph.hide : glyph.show} />
          {open && <span className="nav-text">Hide</span>}
        </button>
        </Tip>
      </div>
      {open && !narrow && (
        <div
          className="nav-grip"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize menu"
          aria-valuemin={168}
          aria-valuemax={480}
          aria-valuenow={Math.round(width)}
          tabIndex={0}
          onPointerDown={startResize}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") resizeTo(width - 16);
            if (event.key === "ArrowRight") resizeTo(width + 16);
          }}
        />
      )}
    </nav>
  );
}

export function App() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [view, setView] = useState<ViewId>(currentView);
  const [authError] = useState<string | null>(authErrorFromUrl);
  const refreshing = useRefreshBusy();
  const [askOpen, setAskOpen] = useState(() => hashName() === "ask");
  const [shellOpen, setShellOpen] = useState(false);

  useEffect(() => {
    if (authError) history.replaceState(null, "", location.pathname);
    readJson<SessionInfo>("/api/session")
      .then(setSession)
      .catch((reason: Error) => setSessionError(reason.message));
  }, [authError]);

  useEffect(() => {
    const onHash = () => {
      if (hashName() === "ask") setAskOpen(true);
      setView(currentView());
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.querySelector("[role='dialog']")) return;
      if (askOpen) setAskOpen(false);
      else if (shellOpen) setShellOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [askOpen, shellOpen]);

  if (sessionError) {
    return (
      <main className="signin">
        <section className="card">
          <h1>headless-ns</h1>
          <p className="error">{sessionError}</p>
        </section>
      </main>
    );
  }

  if (!session) return <LoadingPage cover />;

  if (!session.signedIn) return <SignIn session={session} authError={authError} />;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <img className="mark" src="/favicon.svg" alt="" width="28" height="28" />
          <span>
            <strong>headless-ns</strong>
            <em>NetSuite MCP</em>
          </span>
        </div>
        <div className="who">
          <div className="top-tools">
            <button className={askOpen ? "quiet on" : "quiet"} type="button" aria-pressed={askOpen} onClick={() => setAskOpen((open) => !open)}>
              <Glyph icon={glyph.ask} />
              Ask
            </button>
            <button className="quiet" type="button" onClick={refreshAll}>
              <span className={refreshing ? "spin" : undefined}>
                <Glyph icon={glyph.refresh} />
              </span>
              Refresh
            </button>
            <button className={shellOpen ? "quiet on" : "quiet"} type="button" aria-pressed={shellOpen} onClick={() => setShellOpen((open) => !open)}>
              <Glyph icon={glyph.command} />
              Command line
            </button>
          </div>
          <UserMenu
            accountId={session.accountId}
            roleId={session.roleId}
            canSignOut={session.via === "oidc" || session.via === "netsuite"}
            onSignOut={signOut}
          />
        </div>
      </header>
      <div className={askOpen ? "shell ask-open" : "shell"}>
        <SideNav view={view} />
        <main>
          {view === "overview" && <OverviewPage />}
          {view === "customers" && <CustomersPage />}
          {view === "orders" && (
            <TransactionList title="Orders" path="/api/orders" placeholder="Order number or customer" empty="No open orders matched." />
          )}
          {view === "quotes" && (
            <TransactionList title="Quotes" path="/api/quotes" placeholder="Quote number or customer" empty="No open quotes matched." />
          )}
          {view === "invoices" && <BillsPage title="Invoices" path="/api/invoices" party="Customer" />}
          {view === "bills" && <BillsPage title="Bills" path="/api/bills" party="Vendor" />}
          {view === "items" && <ItemsPage />}
          {view === "people" && <PeoplePage />}
        {view === "reports" && <ReportsPage />}
        {view === "searches" && <SearchesPage />}
        {view === "workbench" && <WorkbenchPage />}
          {view === "trace" && <TracePage />}
          {view === "files" && <FilesPage />}
          {view === "settings" && <SettingsPage />}
        </main>
        <AskDrawer open={askOpen} onClose={() => setAskOpen(false)} />
      </div>
      <RelatedHost />
      <CommandLine
        open={shellOpen}
        onClose={() => setShellOpen(false)}
        onNavigate={(screen) => {
          location.hash = `#/${screen}`;
        }}
      />
    </div>
  );
}

async function signOut() {
  await fetch("/api/auth/logout", { method: "POST" });
  location.href = "/";
}

function SignIn({ session, authError }: { session: SessionInfo; authError: string | null }) {
  const scopes = session.discovery?.scopes ?? [];
  return (
    <main className="signin">
      <section className="card">
        <img className="mark" src="/favicon.svg" alt="" width="28" height="28" />
        <h1>headless-ns</h1>
        <p className="lede">Choose how this server reaches NetSuite. The browser never holds the token.</p>
        <ConnectionPanel />
        <h2>SuiteTalk sign-in</h2>
        {session.osmcpError && <p className="error">{session.osmcpError}</p>}
        {authError && <p className="error">{authError}</p>}
        {session.discovery ? (
          <p className="live-line">
            OIDC discovery is live for <strong>{session.accountId.toUpperCase()}</strong>. Issuer{" "}
            {session.discovery.issuer.replace("https://", "")}. Scopes include {scopes.join(", ")}.{" "}
            {session.discovery.signingKeys > 0
              ? `${session.discovery.signingKeys} signing keys are published.`
              : "No signing keys are published yet. Sign-in still checks the issuer, audience, nonce, and expiry."}
          </p>
        ) : (
          <p className="error">{session.discoveryError || "OIDC discovery did not respond."}</p>
        )}
        <ol className="steps">
          <li>The role you sign in with needs the Setup permission Log in using OAuth 2.0 Access Tokens.</li>
          <li>
            Go to Setup &gt; Integration &gt; Manage Integrations &gt; New. Name it headless-ns and set State to Enabled.
            Under Authentication, check Authorization Code Grant and REST Web Services. Leave Public Client and Client
            Credentials unchecked. Save, then copy the client ID and client secret into <code>.env</code>. NetSuite shows
            them once.
            <span className="uri">{session.redirectUri}</span>
          </li>
          <li>
            Go to Setup &gt; Integration &gt; Manage Authentication &gt; NetSuite as OIDC Provider Setup. Open the
            integration and enable both your entity and your role.
          </li>
          <li>Restart the server, then use Sign in with NetSuite.</li>
        </ol>
        <div className="actions">
          {session.configured ? (
            <a className="primary" href="/api/auth/login">
              <Glyph icon={glyph.signIn} />
              Sign in with NetSuite
            </a>
          ) : (
            <button className="primary" type="button" disabled>
              Sign in with NetSuite
            </button>
          )}
          {!session.configured && <span className="note">Add NETSUITE_CLIENT_ID to .env.</span>}
        </div>
        {session.ephemeralSecret && (
          <p className="note">Add SESSION_SECRET to .env so the local session survives a restart.</p>
        )}
      </section>
    </main>
  );
}

const rangeLabel: Record<RangeId, string> = {
  all: "All dates",
  month: "This month",
  quarter: "This quarter",
  year: "This year",
};

const moneyIds = new Set(["orders", "invoices", "bills"]);

function rowValue(row: MoneyRow, measure: MeasureId) {
  if (measure === "count") return row.n;
  if (measure === "avg") return row.avg ?? (row.n ? (row.amount ?? 0) / row.n : 0);
  if (measure === "min") return row.min ?? 0;
  if (measure === "max") return row.max ?? 0;
  return row.amount ?? 0;
}

function metricView(metric: Metric | undefined, measure: MeasureId) {
  if (metric?.error) return { figure: "—", note: explain(metric.error), failed: true, points: [] as { label: string; value: number }[] };
  if (metric?.rows) {
    const points = metric.rows.map((row) => ({ label: row.currency || "Amount", value: rowValue(row, measure) }));
    const total = points.reduce((sum, point) => sum + point.value, 0);
    const single = points.length === 1 ? metric.rows[0] : null;
    const figure =
      points.length > 1
        ? count(metric.rows.reduce((sum, row) => sum + row.n, 0))
        : measure === "count" || single?.amount == null
          ? count(total)
          : amount(points[0]?.value ?? 0, single?.currency || "");
    const note = points.length > 1 ? "By currency" : measure === "count" ? "Open records" : `${count(single?.n ?? 0)} open`;
    return { figure, note, failed: false, points };
  }
  return { figure: count(metric?.n ?? 0), note: "Active", failed: false, points: [] as { label: string; value: number }[] };
}

function useRangeData<T>(path: string, ranges: string[]) {
  const key = [...new Set(ranges)].sort().join(",");
  const [bundle, setBundle] = useState<Record<string, { data: T | null; error: string | null; loading: boolean }>>({});
  const [generation, setGeneration] = useState(0);

  const reload = useCallback(
    async (range: string, quiet = false) => {
      if (!quiet) {
        setBundle((current) => ({
          ...current,
          [range]: { data: current[range]?.data ?? null, error: null, loading: true },
        }));
      }
      try {
        const response = await fetch(`${path}?range=${range}`);
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
        setBundle((current) => ({ ...current, [range]: { data: body as T, error: null, loading: false } }));
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : "Refresh failed.";
        setBundle((current) => ({
          ...current,
          [range]: { data: current[range]?.data ?? null, error: message, loading: false },
        }));
      }
    },
    [path],
  );

  useEffect(() => {
    const onRefresh = (event: Event) => {
      const scope = (event as CustomEvent<{ scope?: string }>).detail?.scope;
      if (!scope || scope === "dashboard") setGeneration((value) => value + 1);
    };
    window.addEventListener("hn-refresh", onRefresh);
    return () => window.removeEventListener("hn-refresh", onRefresh);
  }, []);

  useEffect(() => {
    const list = key ? key.split(",") : [];
    if (!list.length) return;
    const controller = new AbortController();
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      markBusy(false);
    };
    markBusy(true);
    setBundle((current) => {
      const next = { ...current };
      for (const range of list) next[range] = { data: current[range]?.data ?? null, error: null, loading: true };
      return next;
    });
    let pending = list.length;
    const finishOne = () => {
      pending -= 1;
      if (pending <= 0) done();
    };
    for (const range of list) {
      fetch(`${path}?range=${range}`, { signal: controller.signal })
        .then(async (response) => {
          const body = await response.json().catch(() => ({}));
          if (response.status === 401) {
            location.href = "/api/auth/login";
            return;
          }
          if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
          setBundle((current) => ({ ...current, [range]: { data: body as T, error: null, loading: false } }));
        })
        .catch((reason: Error) => {
          if (reason.name === "AbortError") return;
          setBundle((current) => ({
            ...current,
            [range]: { data: current[range]?.data ?? null, error: reason.message, loading: false },
          }));
        })
        .finally(finishOne);
    }
    return () => {
      controller.abort();
      done();
    };
  }, [path, key, generation]);

  return [bundle, reload] as const;
}

function OverviewPage() {
  const { layout, editing, setEditing, update } = useLayout();
  const overviewRanges = ["all", ...layout.filter((item) => moneyIds.has(item.id)).map((item) => item.range)];
  const activityRanges = layout.filter((item) => item.id === "activity").map((item) => item.range);
  const [overviews, reloadOverview] = useRangeData<Overview>("/api/overview", overviewRanges);
  const [activities, reloadActivity] = useRangeData<Activity>("/api/activity", activityRanges.length ? activityRanges : ["year"]);
  const overview = overviews.all ?? { data: null, error: null, loading: true };
  const activity = activities[layout.find((item) => item.id === "activity")?.range || "year"] ?? { data: null, error: null, loading: true };
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [refreshEvery] = useRefreshInterval();
  const [spinId, setSpinId] = useState<string | null>(null);

  useEffect(() => {
    const ms = refreshMs(refreshEvery);
    if (!ms) return;
    const timer = window.setInterval(() => refreshScope("dashboard"), ms);
    return () => window.clearInterval(timer);
  }, [refreshEvery]);

  function move(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const next = [...layout];
    const from = next.findIndex((item) => item.id === dragId);
    const to = next.findIndex((item) => item.id === targetId);
    if (from < 0 || to < 0) return;
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    update(next);
  }

  function nudge(id: string, step: number) {
    const next = [...layout];
    const index = next.findIndex((item) => item.id === id);
    const to = index + step;
    if (index < 0 || to < 0 || to >= next.length) return;
    const [item] = next.splice(index, 1);
    next.splice(to, 0, item);
    update(next);
  }

  function patch(id: string, change: Partial<PortletPref>) {
    update(layout.map((item) => (item.id === id ? { ...item, ...change } : item)));
  }

  function cycle(id: string) {
    const order: Span[] = [4, 6, 12];
    const current = layout.find((item) => item.id === id);
    const span = order[(Math.max(0, order.indexOf(current?.span || 4)) + 1) % order.length];
    patch(id, { span });
  }

  const hidden = layout.filter((item) => item.hidden);

  const firstLoad = overview.loading && !overview.data && !overview.error;

  return (
    <>
      <header className="page-head">
        <div>
          <div className="kicker">Home</div>
          <h1>Overview</h1>
        </div>
        <div className="page-tools">
          <RefreshIntervalSelect />
          <button className={editing ? "quiet on" : "quiet"} type="button" aria-pressed={editing} onClick={() => setEditing((value) => !value)}>
            <Glyph icon={glyph.arrange} />
            {editing ? "Done" : "Arrange"}
          </button>
        </div>
      </header>
      {editing && <p className="status">Drag a card to reorder it. Each card can change its dates, figure, and chart. This browser keeps the layout.</p>}
      {overview.error && <p className="error">{overview.error}</p>}
      {firstLoad ? (
        <SkeletonPortlets />
      ) : (
      <section className={overview.loading ? "portlets is-loading" : "portlets"} aria-label="Home cards">
          {layout.map((pref, index) => {
            if (pref.hidden && !editing) return null;
            const card = portletCatalog.find((item) => item.id === pref.id);
            if (!card) return null;
            const source = moneyIds.has(pref.id) ? overviews[pref.range] ?? overview : overview;
            const metric = card.metric ? metricView(source.data?.metrics[card.metric], pref.measure) : null;
            const activityCard = card.kind === "activity" ? activities[pref.range] ?? activity : null;
            const activityPoints =
              activityCard?.data?.rows.map((row) => ({ label: typeLabels[row.type] || row.type, value: row.n })) ?? [];
            const activityValues = activityPoints.map((point) => point.value);
            const activityTotal = activityValues.reduce((sum, value) => sum + value, 0);
            const activityFigure =
              pref.measure === "avg"
                ? count(activityValues.length ? activityTotal / activityValues.length : 0)
                : pref.measure === "min"
                  ? count(activityValues.length ? Math.min(...activityValues) : 0)
                  : pref.measure === "max"
                    ? count(activityValues.length ? Math.max(...activityValues) : 0)
                    : count(activityTotal);
            const chartable = card.kind === "activity" ? activityPoints.length > 1 : (metric?.points.length ?? 0) > 1;
            const visual: VisualId = chartable ? pref.visual : "number";
            const sharedLoading = card.kind === "activity" ? Boolean(activityCard?.loading && activityCard.data) : Boolean(source.loading && source.data);
            const reloading = spinId === pref.id || (spinId === null && sharedLoading);
            const className = [
              "portlet",
              !editing && card.href ? "is-link" : "",
              editing ? "is-editing" : "",
              pref.hidden ? "is-hidden" : "",
              overId === pref.id ? "is-over" : "",
              reloading ? "is-loading" : "",
            ]
              .filter(Boolean)
              .join(" ");
            const tools = editing ? (
              <div className="portlet-tools">
                <span
                  className="drag"
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/plain", pref.id);
                    event.dataTransfer.effectAllowed = "move";
                    setDragId(pref.id);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverId(null);
                  }}
                >
                  <Glyph icon={glyph.move} size={14} />
                  Move
                </span>
                <button className="quiet" type="button" disabled={index === 0} onClick={() => nudge(pref.id, -1)}>
                  <Glyph icon={glyph.up} size={14} />
                  Up
                </button>
                <button className="quiet" type="button" disabled={index === layout.length - 1} onClick={() => nudge(pref.id, 1)}>
                  <Glyph icon={glyph.down} size={14} />
                  Down
                </button>
                <button className="quiet" type="button" onClick={() => cycle(pref.id)} aria-label={`Width ${widthWord(pref.span)}`}>
                  {widthWord(pref.span)}
                </button>
                <button className="quiet" type="button" onClick={() => patch(pref.id, { hidden: !pref.hidden })}>
                  <Glyph icon={pref.hidden ? glyph.eye : glyph.eyeOff} size={14} />
                  {pref.hidden ? "Show" : "Hide"}
                </button>
              </div>
            ) : null;
            const dated = card.kind === "activity" || moneyIds.has(pref.id);
            const measures: MeasureId[] = card.kind === "activity" || moneyIds.has(pref.id) ? ["count", "sum", "avg", "min", "max"] : ["count"];
            const config = editing ? (
              <div className="portlet-config">
                <label>
                  Dates
                  <Pick
                    label={`${card.label} dates`}
                    value={dated ? pref.range : "all"}
                    disabled={!dated}
                    onChange={(next) => patch(pref.id, { range: next as RangeId })}
                    options={(dated ? (Object.keys(rangeLabel) as RangeId[]) : (["all"] as RangeId[])).map((id) => ({
                      value: id,
                      label: dated ? rangeLabel[id] : "Current",
                    }))}
                  />
                </label>
                <label>
                  Figure
                  <Pick
                    label={`${card.label} figure`}
                    value={measures.includes(pref.measure) ? pref.measure : "count"}
                    onChange={(next) => patch(pref.id, { measure: next as MeasureId })}
                    options={measures.map((id) => ({
                      value: id,
                      label: id === "count" ? "Count" : id === "sum" ? "Sum" : id === "avg" ? "Average" : id === "min" ? "Minimum" : "Maximum",
                    }))}
                  />
                </label>
                <label>
                  Chart
                  <Pick
                    label={`${card.label} chart`}
                    value={visual}
                    disabled={!chartable}
                    onChange={(next) => patch(pref.id, { visual: next as VisualId })}
                    options={[
                      { value: "number", label: "Number" },
                      ...(chartable
                        ? [
                            { value: "bar", label: "Bar" },
                            { value: "pie", label: "Pie" },
                            { value: "line", label: "Line" },
                          ]
                        : []),
                    ]}
                  />
                </label>
              </div>
            ) : null;
            const points = card.kind === "activity" ? activityPoints : metric?.points ?? [];
            const shown =
              visual === "number" ? null : <SeriesChart kind={visual} points={points.filter((point) => point.label)} />;
            const body =
              card.kind === "activity" ? (
                <div className="body">
                  {config}
                  <strong>{activityFigure}</strong>
                  <p className="status">{rangeLabel[pref.range]}</p>
                  {activityCard?.error && <p className="error">{activityCard.error}</p>}
                  {activityCard?.loading && !activityCard.data && <Lookup label="Looking up transactions." />}
                  {shown}
                  {visual === "number" && activityCard?.data && (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Type</th>
                            <th className="num">Count</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activityCard.data.rows.map((row) => (
                            <tr key={row.type}>
                              <td>{typeLabels[row.type] || row.type}</td>
                              <td className="num">{count(row.n)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : (
                <div className="body">
                  {config}
                  {visual === "number" && <strong>{metric?.figure}</strong>}
                  {shown}
                  {metric?.note && <em className={metric.failed ? "fail" : ""}>{metric.note}</em>}
                </div>
              );
            const inner = (
              <>
                <header>
                  <span>{card.kind === "activity" ? `Transactions, ${rangeLabel[pref.range].toLowerCase()}` : card.label}</span>
                  <div className="portlet-end">
                    {!editing && (
                      <RefreshButton
                        label={card.label}
                        busy={spinId === pref.id}
                        onClick={() => {
                          const range = card.kind === "activity" ? pref.range : moneyIds.has(pref.id) ? pref.range : "all";
                          const run = card.kind === "activity" ? reloadActivity : reloadOverview;
                          setSpinId(pref.id);
                          run(range, true).finally(() => setSpinId((current) => (current === pref.id ? null : current)));
                        }}
                      />
                    )}
                    {tools}
                  </div>
                </header>
                {body}
              </>
            );
            return (
              <section
                key={pref.id}
                className={className}
                data-span={pref.span}
                onClick={(event) => {
                  if (editing || !card.href) return;
                  const target = event.target as HTMLElement;
                  if (target.closest("button, a, select, label, input")) return;
                  location.hash = card.href;
                }}
                onDragOver={(event) => {
                  if (!editing) return;
                  event.preventDefault();
                  setOverId(pref.id);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  move(pref.id);
                  setOverId(null);
                }}
              >
                {inner}
              </section>
            );
          })}
      </section>
      )}
      {editing && hidden.length > 0 && (
        <p className="status">
          {hidden.length} {hidden.length === 1 ? "card is" : "cards are"} hidden. Use Show on a card to bring it back.
        </p>
      )}
    </>
  );
}

function ListFrame({
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
          <RefreshButton label={title} scope={scope} busy={loading && ready} />
        </div>
      </header>
      {error && <p className="error">{explain(error)}</p>}
      <section className={loading && ready ? "list-view is-loading" : "list-view"}>
        <div className="list-bar">
          <strong>{viewName}</strong>
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

function StatusPill({ value }: { value: string }) {
  const text = value || "—";
  const tone = /closed|expired|cancel|void|no/i.test(text) ? "warn" : /billed|paid|open|yes|active|pending/i.test(text) ? "ok" : "";
  return <span className={tone ? `pill ${tone}` : "pill"}>{text}</span>;
}

function listStatus<T>(payload: { data: ListPayload<T> | null; loading: boolean }) {
  if (!payload.data) return "";
  const shown = payload.data.rows.length;
  const total = payload.data.total;
  const range = total != null ? `Showing ${count(shown)} of ${count(total)}` : `Showing ${count(shown)}`;
  const updating = payload.loading ? " · updating" : "";
  const via =
    payload.data.source === "OpenSuiteMCP"
      ? " · OpenSuiteMCP"
      : payload.data.tokenExpiresAt
        ? ` · token expires ${clock(payload.data.tokenExpiresAt)}`
        : "";
  return `${range}${updating} · read at ${clock(payload.data.fetchedAt)}${via}`;
}

function explain(message: string) {
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

function RecordActions({
  kind,
  id,
  title,
  href,
}: {
  kind: "customer" | "transaction" | "item" | "employee";
  id: string;
  title: string;
  href: string;
}) {
  return (
    <div className="row-actions">
      <RelatedLink kind={kind} id={id} title={title} />
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

function CustomersPage() {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const q = useDebounced(search, 300);
  const live = useLive<ListPayload<Customer>>(`/api/customers${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  const file = useLive<CustomerFile>(selected ? `/api/customers/${selected}` : null);
  return (
    <ListFrame
      title="Customers"
      viewName="All customers"
      status={listStatus(live)}
      error={live.error}
      loading={live.loading}
      ready={Boolean(live.data)}
      search={search}
      onSearch={setSearch}
      placeholder="Name or email"
      scope={q ? `/api/customers?q=${encodeURIComponent(q)}` : "/api/customers"}
    >
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Company</th>
              <th>Subsidiary</th>
              <th>Email</th>
              <th>Phone</th>
              <th>NetSuite</th>
            </tr>
          </thead>
          <tbody>
            {live.data?.rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <button className="linkish" type="button" onClick={() => setSelected(row.id)}>
                    {row.name}
                  </button>
                </td>
                <td>{row.company || "—"}</td>
                <td>{row.subsidiary || "—"}</td>
                <td>{row.email || "—"}</td>
                <td>{row.phone || "—"}</td>
                <td>
                  <RecordActions kind="customer" id={row.id} title={row.name} href={row.href} />
                </td>
              </tr>
            ))}
            {live.data && live.data.rows.length === 0 && (
              <tr>
                <td className="empty" colSpan={6}>
                  No customers matched.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {selected && <CustomerFilePanel file={file} scope={`/api/customers/${selected}`} onClose={() => setSelected(null)} />}
    </ListFrame>
  );
}

function CustomerFilePanel({
  file,
  scope,
  onClose,
}: {
  file: { data: CustomerFile | null; error: string | null; loading: boolean };
  scope: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const customer = file.data?.customer;
  return (
    <div className="backdrop" role="presentation" onClick={onClose}>
        <aside className="drawer" role="dialog" aria-label={customer?.name || "Customer"} onClick={(event) => event.stopPropagation()}>
        <header className="record-top">
          <div className="drawer-top">
            <div>
              <div className="kicker">Customer</div>
              <h2>{customer?.name || "Customer"}</h2>
            </div>
            <div className="actions">
              {customer && (
                <>
                  <RelatedLink kind="customer" id={customer.id} title={customer.name} />
                  <a className="quiet" href={customer.href} target="_blank" rel="noreferrer">
                    <Glyph icon={glyph.external} size={14} />
                    Open in NetSuite
                  </a>
                </>
              )}
              <RefreshButton label="customer" scope={scope} busy={file.loading && Boolean(customer)} />
              <button className="quiet" type="button" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
          {file.loading && !customer && (
            <>
              <Lookup label="Looking up this customer." />
              <SkeletonRecord />
            </>
          )}
          {file.error && <p className="error">{explain(file.error)}</p>}
          {customer && (
            <>
              <div className="highlights">
                <div>
                  <span>Company</span>
                  <strong>{customer.company || "—"}</strong>
                </div>
                <div>
                  <span>Subsidiary</span>
                  <strong>{customer.subsidiary || "—"}</strong>
                </div>
                <div>
                  <span>Email</span>
                  <strong>{customer.email || "—"}</strong>
                </div>
                <div>
                  <span>Phone</span>
                  <strong>{customer.phone || "—"}</strong>
                </div>
                <div>
                  <span>Open balance</span>
                  <strong>
                    {file.data?.balance.length
                      ? file.data.balance.map((row) => amount(row.amount, row.currency)).join(", ")
                      : "0.00"}
                  </strong>
                </div>
              </div>
              <nav className="quick" aria-label="Related lists">
                <a href="#related-orders">Orders {file.data?.orders.length ?? 0}</a>
                <a href="#related-invoices">Invoices {file.data?.invoices.length ?? 0}</a>
              </nav>
            </>
          )}
        </header>
        {customer && (
          <div className="record-body">
            <RelatedList
              id="related-orders"
              title="Open orders"
              count={file.data?.orders.length ?? 0}
              headers={["Number", "Date", "Status", "Amount", ""]}
              empty="No open orders."
              rows={file.data?.orders ?? []}
              render={(row) => (
                <>
                  <td>{row.number}</td>
                  <td>{dateLabel(row.date)}</td>
                  <td>
                    <StatusPill value={row.status} />
                  </td>
                  <td className="num">{amount(row.amount, row.currency)}</td>
                  <td>
                    <RecordActions kind="transaction" id={row.id} title={row.number} href={row.href} />
                  </td>
                </>
              )}
            />
            <RelatedList
              id="related-invoices"
              title="Open invoices"
              count={file.data?.invoices.length ?? 0}
              headers={["Number", "Due", "Open", ""]}
              empty="No open invoices."
              rows={file.data?.invoices ?? []}
              render={(row) => (
                <>
                  <td>{row.number}</td>
                  <td>{dateLabel(row.due)}</td>
                  <td className="num">{amount(row.unpaid, row.currency)}</td>
                  <td>
                    <RecordActions kind="transaction" id={row.id} title={row.number} href={row.href} />
                  </td>
                </>
              )}
            />
          </div>
        )}
      </aside>
    </div>
  );
}

function RelatedList<T extends { id: string }>({
  id,
  title,
  count: total,
  headers,
  rows,
  empty,
  render,
}: {
  id: string;
  title: string;
  count: number;
  headers: string[];
  rows: T[];
  empty: string;
  render: (row: T) => ReactNode;
}) {
  return (
    <section className="related" id={id}>
      <header>
        {title}
        <span>{total}</span>
      </header>
      {rows.length === 0 ? (
        <p className="status">{empty}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {headers.map((header) => (
                  <th key={header || "action"}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>{render(row)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function TransactionList({
  title,
  path,
  placeholder,
  empty,
}: {
  title: string;
  path: string;
  placeholder: string;
  empty: string;
}) {
  const [search, setSearch] = useState("");
  const q = useDebounced(search, 300);
  const live = useLive<ListPayload<Order>>(`${path}${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  return (
    <ListFrame title={title} viewName={`Open ${title.toLowerCase()}`} status={listStatus(live)} error={live.error} loading={live.loading} ready={Boolean(live.data)} search={search} onSearch={setSearch} placeholder={placeholder} scope={q ? `${path}?q=${encodeURIComponent(q)}` : path}>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Number</th>
              <th>Date</th>
              <th>Customer</th>
              <th>Status</th>
              <th className="num">Amount</th>
              <th>NetSuite</th>
            </tr>
          </thead>
          <tbody>
            {live.data?.rows.map((row) => (
              <tr key={row.id}>
                <td>{row.number}</td>
                <td>{dateLabel(row.date)}</td>
                <td>{row.customer}</td>
                <td>
                  <StatusPill value={row.status} />
                </td>
                <td className="num">{amount(row.amount, row.currency)}</td>
                <td>
                  <RecordActions kind="transaction" id={row.id} title={row.number} href={row.href} />
                </td>
              </tr>
            ))}
            {live.data && live.data.rows.length === 0 && (
              <tr>
                <td className="empty" colSpan={6}>
                  {empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </ListFrame>
  );
}

function BillsPage({ title, path, party }: { title: string; path: string; party: string }) {
  const [search, setSearch] = useState("");
  const q = useDebounced(search, 300);
  const live = useLive<ListPayload<Bill>>(`${path}${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  return (
    <ListFrame
      title={title}
      viewName={`Open ${title.toLowerCase()}`}
      status={listStatus(live)}
      error={live.error}
      loading={live.loading}
      ready={Boolean(live.data)}
      search={search}
      onSearch={setSearch}
      placeholder={`Number or ${party.toLowerCase()}`}
      scope={q ? `${path}?q=${encodeURIComponent(q)}` : path}
    >
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Number</th>
              <th>Date</th>
              <th>Due</th>
              <th>{party}</th>
              <th className="num">Amount</th>
              <th className="num">Open</th>
              <th>NetSuite</th>
            </tr>
          </thead>
          <tbody>
            {live.data?.rows.map((row) => (
              <tr key={row.id}>
                <td>{row.number}</td>
                <td>{dateLabel(row.date)}</td>
                <td>{dateLabel(row.due)}</td>
                <td>{row.name}</td>
                <td className="num">{amount(row.amount, row.currency)}</td>
                <td className="num">{amount(row.unpaid, row.currency)}</td>
                <td>
                  <RecordActions kind="transaction" id={row.id} title={row.number} href={row.href} />
                </td>
              </tr>
            ))}
            {live.data && live.data.rows.length === 0 && (
              <tr>
                <td className="empty" colSpan={7}>
                  No open {title.toLowerCase()} matched.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </ListFrame>
  );
}

function ItemsPage() {
  const [search, setSearch] = useState("");
  const q = useDebounced(search, 300);
  const live = useLive<ListPayload<Item>>(`/api/items${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  return (
    <ListFrame
      title="Items"
      viewName="Inventory parts"
      status={listStatus(live)}
      error={live.error}
      loading={live.loading}
      ready={Boolean(live.data)}
      search={search}
      onSearch={setSearch}
      placeholder="Item name"
      scope={q ? `/api/items?q=${encodeURIComponent(q)}` : "/api/items"}
    >
      {live.data?.note && <p className="status">{explain(live.data.note)}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Display name</th>
              <th className="num">On hand</th>
              <th className="num">Available</th>
              <th>NetSuite</th>
            </tr>
          </thead>
          <tbody>
            {live.data?.rows.map((row) => (
              <tr key={row.id}>
                <td>{row.name}</td>
                <td>{row.displayName || "—"}</td>
                <td className="num">{row.onHand == null ? "—" : count(row.onHand)}</td>
                <td className="num">{row.available == null ? "—" : count(row.available)}</td>
                <td>
                  <RecordActions kind="item" id={row.id} title={row.name} href={row.href} />
                </td>
              </tr>
            ))}
            {live.data && live.data.rows.length === 0 && (
              <tr>
                <td className="empty" colSpan={5}>
                  No inventory items matched.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </ListFrame>
  );
}

function PeoplePage() {
  const [search, setSearch] = useState("");
  const q = useDebounced(search, 300);
  const live = useLive<ListPayload<Person>>(`/api/employees${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  return (
    <ListFrame
      title="People"
      viewName="Active employees"
      status={listStatus(live)}
      error={live.error}
      loading={live.loading}
      ready={Boolean(live.data)}
      search={search}
      onSearch={setSearch}
      placeholder="Name, title, or email"
      scope={q ? `/api/employees?q=${encodeURIComponent(q)}` : "/api/employees"}
    >
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Title</th>
              <th>Subsidiary</th>
              <th>Email</th>
              <th>Hired</th>
              <th>Sales rep</th>
              <th>NetSuite</th>
            </tr>
          </thead>
          <tbody>
            {live.data?.rows.map((row) => (
              <tr key={row.id}>
                <td>{row.name}</td>
                <td>{row.title || "—"}</td>
                <td>{row.subsidiary || "—"}</td>
                <td>{row.email || "—"}</td>
                <td>{dateLabel(row.hireDate)}</td>
                <td>
                  <StatusPill value={row.salesRep === "Yes" || row.salesRep === "T" ? "Yes" : row.salesRep || "No"} />
                </td>
                <td>
                  <RecordActions kind="employee" id={row.id} title={row.name} href={row.href} />
                </td>
              </tr>
            ))}
            {live.data && live.data.rows.length === 0 && (
              <tr>
                <td className="empty" colSpan={7}>
                  No employees matched.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </ListFrame>
  );
}
