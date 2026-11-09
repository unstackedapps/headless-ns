import { useEffect, useState } from "react";
import { Glyph, glyph } from "./icons";
import { Lookup, SkeletonTable } from "./load";
import { refreshScope, RefreshButton } from "./refresh";
import { FilterRail } from "./rail";
import { DataTable } from "./table";
import { orBlank } from "./format";
import { api, postJson } from "./api";
import { PageHead } from "./head";

type SearchRow = { id: string; title: string; recordType: string; shared: boolean };
type SearchRun = { columns: string[]; rows: Record<string, string | number>[]; total: number };

function cellText(value: string | number | null | undefined) {
  return value == null ? "" : String(value);
}

function visibleRows(run: SearchRun, needle: string, filters: Record<string, string>, sort: { column: string; dir: "asc" | "desc" } | null) {
  // shortcut: search, filter, and sort apply to the first 50 rows the saved search returned
  const query = needle.trim().toLowerCase();
  let rows = run.rows.filter((row) => {
    if (query && !run.columns.some((column) => cellText(row[column]).toLowerCase().includes(query))) return false;
    return run.columns.every((column) => {
      const filter = (filters[column] || "").trim().toLowerCase();
      return !filter || cellText(row[column]).toLowerCase().includes(filter);
    });
  });
  if (sort) {
    const dir = sort.dir === "asc" ? 1 : -1;
    rows = [...rows].sort((a, b) => cellText(a[sort.column]).localeCompare(cellText(b[sort.column]), undefined, { numeric: true }) * dir);
  }
  return rows;
}

export function SearchesPage() {
  const [rows, setRows] = useState<SearchRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<SearchRow | null>(null);
  const [run, setRun] = useState<SearchRun | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [needle, setNeedle] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ column: string; dir: "asc" | "desc" } | null>(null);

  useEffect(() => {
    let stop = false;
    function load() {
      api<{ rows?: SearchRow[] }>("/api/searches")
        .then((body) => {
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
    setNeedle("");
    setFilters({});
    setSort(null);
    setRunning(true);
    try {
      setRun(await postJson<SearchRun>("/api/searches/run", { id: row.id }));
    } catch (reason) {
      setRunError(reason instanceof Error ? reason.message : "The saved search did not run.");
    } finally {
      setRunning(false);
    }
  }

  const shown = run ? visibleRows(run, needle, filters, sort) : [];

  if (!rows && !error) {
    return (
      <>
        <PageHead title="Searches" />
        <SkeletonTable rows={8} cols={2} />
      </>
    );
  }

  return (
    <div className="split-page">
      <PageHead title="Searches">
        <RefreshButton label="searches" onClick={() => refreshScope("searches")} />
      </PageHead>
      <p className="status">A search shows its first 50 rows.</p>
      {error && <p className="error">{error}</p>}
      <div className="split">
        <FilterRail
          label="Filter searches"
          placeholder="Filter by name or record"
          items={(rows || []).map((row) => ({ key: row.id, title: row.title || row.id, note: row.recordType || undefined }))}
          selected={chosen?.id}
          onPick={(id) => {
            const row = rows?.find((item) => item.id === id);
            if (row) openSearch(row);
          }}
          empty="This role has no saved searches."
        />
        <div className="split-main">
          {!chosen && <p className="split-empty">Pick a search on the left.</p>}
          {running && <Lookup label="Running the search." />}
          {runError && <p className="error">{runError}</p>}
          {run && (
            <>
              <label className="search-field">
                <Glyph icon={glyph.search} size={14} />
                <input className="search" value={needle} placeholder="Search these rows" onChange={(event) => setNeedle(event.target.value)} />
              </label>
              <DataTable
                label={chosen?.title || "Search results"}
                wrap="plain"
                rows={shown}
                rowKey={(_, index) => index}
                empty={run.rows.length === 0 ? "The search returned no rows." : "No rows match."}
                columns={run.columns.map((column) => ({
                  key: column,
                  sort: sort?.column === column ? (sort.dir === "asc" ? "ascending" : "descending") : "none",
                  label: (
                    <button className="th-sort" type="button" onClick={() => setSort((current) => (current?.column === column && current.dir === "asc" ? { column, dir: "desc" } : { column, dir: "asc" }))}>
                      {column}
                      {sort?.column === column ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
                    </button>
                  ),
                  cell: (row: Record<string, unknown>) => orBlank(row[column]),
                }))}
                head={
                  <tr>
                    {run.columns.map((column) => (
                      <th key={`${column}-filter`}>
                        <input
                          className="col-filter"
                          aria-label={`Filter ${column}`}
                          value={filters[column] || ""}
                          placeholder="Filter"
                          onChange={(event) => setFilters((current) => ({ ...current, [column]: event.target.value }))}
                        />
                      </th>
                    ))}
                  </tr>
                }
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
