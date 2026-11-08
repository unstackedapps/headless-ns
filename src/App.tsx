import { useEffect, useState } from "react";
import { UserMenu } from "./account";
import { AskDrawer, CommandLine } from "./chrome";
import { FilesPage } from "./files";
import { type PageId } from "./menu";
import { RelatedHost } from "./related";
import { SearchesPage } from "./searches";
import { Glyph, glyph } from "./icons";
import { LoadingPage } from "./load";
import { refreshAll, useRefreshBusy } from "./refresh";
import { QueryPage } from "./query";
import { RecordsPage } from "./records";
import { ReportsPage, SettingsPage, TracePage, WorkbenchPage } from "./studio";
import { api, postJson } from "./api";
import { CustomersPage } from "./customers";
import { ItemsPage } from "./items";
import { SideNav, currentView, hashName } from "./nav";
import { OverviewPage } from "./overview";
import { PeoplePage } from "./people";
import { SignIn, type SessionInfo } from "./signin";
import { TransactionList } from "./transactions";
import { TransactionPage } from "./transaction";
import { VendorsPage } from "./vendors";

function authErrorFromUrl() {
  return new URLSearchParams(location.search).get("auth_error");
}

export function App() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [view, setView] = useState<PageId>(currentView);
  const [authError] = useState<string | null>(authErrorFromUrl);
  const refreshing = useRefreshBusy();
  const [askOpen, setAskOpen] = useState(() => hashName() === "ask");
  const [shellOpen, setShellOpen] = useState(false);

  useEffect(() => {
    if (authError) history.replaceState(null, "", location.pathname);
    api<SessionInfo>("/api/session", { signInOn401: true })
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
          {view === "orders" && <TransactionList key="orders" list="orders" title="Orders" recordType="salesorder" party="Customer" canCreate />}
          {view === "quotes" && <TransactionList key="quotes" list="quotes" title="Quotes" recordType="estimate" party="Customer" canCreate />}
          {view === "invoices" && <TransactionList key="invoices" list="invoices" title="Invoices" recordType="invoice" party="Customer" money />}
          {view === "vendors" && <VendorsPage />}
          {view === "purchaseorders" && (
            <TransactionList key="purchaseorders" list="purchaseorders" title="Purchase orders" recordType="purchaseorder" party="Vendor" canCreate />
          )}
          {view === "bills" && <TransactionList key="bills" list="bills" title="Bills" recordType="vendorbill" party="Vendor" money />}
          {view === "items" && <ItemsPage />}
          {view === "people" && <PeoplePage />}
        {view === "reports" && <ReportsPage />}
        {view === "searches" && <SearchesPage />}
        {view === "workbench" && <WorkbenchPage />}
          {view === "trace" && <TracePage />}
          {view === "files" && <FilesPage />}
          {view === "records" && <RecordsPage />}
          {view === "transaction" && <TransactionPage />}
          {view === "query" && <QueryPage />}
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
  await postJson("/api/auth/logout", {});
  location.href = "/";
}
