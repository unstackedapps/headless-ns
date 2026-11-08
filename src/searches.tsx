import { useEffect, useState } from "react";
import { Glyph, glyph } from "./icons";
import { SkeletonTable } from "./load";
import { refreshScope, RefreshButton } from "./refresh";

type SearchRow = { id: string; title: string; recordType: string; shared: boolean };
type SearchRun = { columns: string[]; rows: Record<string, string | number>[]; total: number };

export function SearchesPage() {
  const [rows, setRows] = useState<SearchRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<SearchRow | null>(null);
  const [run, setRun] = useState<SearchRun | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let stop = false;
    function load() {
      fetch("/api/searches")
        .then(async (response) => {
          const body = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(body.error || "Saved searches did not load.");
          if (!stop) {
            setRows(body.rows || []);
            setError(null);
          }
        })
        .catch((reason: Error) => {
          if (!stop) setError(reason.message);
        });
    }
    load();
    const onRefresh = (event: Event) => {
      const scope = (event as CustomEvent<{ scope?: string }>).detail?.scope;
      if (!scope || scope === "searches") load();
    };
    window.addEventListener("hn-refresh", onRefresh);
    return () => {
      stop = true;
      window.removeEventListener("hn-refresh", onRefresh);
    };
  }, []);

  async function openSearch(row: SearchRow) {
    setChosen(row);
    setRun(null);
    setRunError(null);
    setRunning(true);
    try {
      const response = await fetch("/api/searches/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "The saved search did not run.");
      setRun(body);
    } catch (reason) {
      setRunError(reason instanceof Error ? reason.message : "The saved search did not run.");
    } finally {
      setRunning(false);
    }
  }

  if (!rows && !error) {
    return (
      <>
        <header className="page-head">
          <div>
            <div className="kicker">Saved searches</div>
            <h1>Searches</h1>
          </div>
        </header>
        <SkeletonTable rows={8} cols={2} />
      </>
    );
  }

  return (
    <div className="split-page">
      <header className="page-head">
        <div>
          <div className="kicker">Saved searches</div>
          <h1>Searches</h1>
        </div>
        <RefreshButton label="searches" onClick={() => refreshScope("searches")} />
      </header>
      <p className="status">These are the saved searches for this role. Opening one lists the first 50 rows.</p>
      {error && <p className="error">{error}</p>}
      <div className="split">
        <div className="split-rail">
          <label className="search-field">
            <Glyph icon={glyph.search} size={14} />
            <input className="search" value={query} placeholder="Filter by name or record" onChange={(event) => setQuery(event.target.value)} />
          </label>
          <div className="tool-list">
          {(rows || [])
            .filter((row) => `${row.title} ${row.recordType}`.toLowerCase().includes(query.trim().toLowerCase()))
            .map((row) => (
            <button key={row.id} type="button" className={chosen?.id === row.id ? "tool on" : "tool"} onClick={() => openSearch(row)}>
              <span>{row.title || row.id}</span>
              {row.recordType ? <em>{row.recordType}</em> : null}
            </button>
          ))}
          {rows && rows.length === 0 && <p className="status">This role has no saved searches.</p>}
          </div>
        </div>
        <div className="split-main">
          {!chosen && <p className="split-empty">Pick a search on the left.</p>}
          {running && <p className="status">Running the search.</p>}
          {runError && <p className="error">{runError}</p>}
          {run && (
            <div className="table-wrap plain">
              <table>
                <thead>
                  <tr>
                    {run.columns.map((column) => (
                      <th key={column}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {run.rows.map((row, index) => (
                    <tr key={index}>
                      {run.columns.map((column) => (
                        <td key={column}>{row[column] === "" || row[column] == null ? "—" : String(row[column])}</td>
                      ))}
                    </tr>
                  ))}
                  {run.rows.length === 0 && (
                    <tr>
                      <td className="empty" colSpan={Math.max(1, run.columns.length)}>
                        The search returned no rows.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
