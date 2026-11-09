import { useEffect, useRef, useState } from "react";
import { Glyph, glyph } from "./icons";
import { Button } from "./load";
import { Pager } from "./lists";
import { Pick } from "./pick";
import { FilterRail } from "./rail";
import { RefreshButton, refreshScope } from "./refresh";
import { addColumn, commonTables, isMissingLabel, sampleQueries, toCsv } from "./sql";
import { DataTable } from "./table";
import { orBlank } from "./format";
import { api, postJson } from "./api";
import { PageHead } from "./head";

type TableInfo = { name: string; title: string };
type Field = { id: string; title: string; type: string };
type Result = { columns: string[]; rows: Record<string, unknown>[]; page: number; hasMore: boolean; total: number | null };
type Saved = { name: string; sql: string };

const PAGE = 100;
const CSV_PAGE = 1000;
const CSV_MAX = 5000;

// Query: write a SELECT, run it, page through the rows, export them, and save it by name.
export function QueryPage() {
  const [tables, setTables] = useState<TableInfo[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [chosen, setChosen] = useState<TableInfo | null>(null);
  const [fields, setFields] = useState<Field[] | null>(null);
  const [sql, setSql] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [running, setRunning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const chosenRef = useRef("");

  useEffect(() => {
    let stop = false;
    function load(fresh = false) {
      api<{ tables: TableInfo[] }>(`/api/suiteql${fresh ? "?fresh=1" : ""}`)
        .then((body) => {
          if (!stop) setTables(body.tables);
        })
        .catch((reason: Error) => {
          if (!stop) setError(reason.message);
        });
    }
    load();
    api<{ queries: Saved[] }>("/api/queries")
      .then((body) => {
        if (!stop) setSaved(body.queries || []);
      })
      .catch(() => undefined);
    const onRefresh = (event: Event) => {
      const scope = (event as CustomEvent<{ scope?: string }>).detail?.scope;
      if (!scope || scope === "query") load(scope === "query");
    };
    window.addEventListener("hn-refresh", onRefresh);
    return () => {
      stop = true;
      window.removeEventListener("hn-refresh", onRefresh);
    };
  }, []);

  function choose(tableName: string) {
    const table = tables?.find((item) => item.name === tableName);
    if (!table) return;
    chosenRef.current = tableName;
    setChosen(table);
    setFields(null);
    setError(null);
    api<{ fields: Field[] }>(`/api/suiteql?type=${encodeURIComponent(table.name)}`)
      .then((body) => {
        if (chosenRef.current === tableName) setFields(body.fields);
      })
      .catch((reason: Error) => setError(reason.message));
  }

  async function run(page = 0) {
    if (!sql.trim()) return;
    setRunning(true);
    setRunError(null);
    try {
      setResult(await postJson<Result>("/api/query", { sql, page, pageSize: PAGE }));
    } catch (reason) {
      setRunError(reason instanceof Error ? reason.message : "The query failed.");
    } finally {
      setRunning(false);
    }
  }

  async function exportCsv() {
    setExporting(true);
    setRunError(null);
    try {
      const rows: Record<string, unknown>[] = [];
      let columns: string[] = [];
      for (let page = 0; page * CSV_PAGE < CSV_MAX; page += 1) {
        const body = await postJson<Result>("/api/query", { sql, page, pageSize: CSV_PAGE });
        if (!columns.length) columns = body.columns;
        rows.push(...body.rows);
        if (!body.hasMore) break;
      }
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([toCsv(columns, rows)], { type: "text/csv" }));
      link.download = `${(name.trim() || "query").replace(/[^A-Za-z0-9_-]+/g, "-")}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (reason) {
      setRunError(reason instanceof Error ? reason.message : "The export failed.");
    } finally {
      setExporting(false);
    }
  }

  async function save() {
    try {
      setSaved((await postJson<{ queries: Saved[] }>("/api/queries", { name, sql })).queries);
      setRunError(null);
    } catch (reason) {
      setRunError(reason instanceof Error ? reason.message : "The query was not saved.");
    }
  }

  async function remove() {
    try {
      setSaved((await postJson<{ queries: Saved[] }>("/api/queries/delete", { name })).queries);
      setName("");
    } catch (reason) {
      setRunError(reason instanceof Error ? reason.message : "The query is still saved.");
    }
  }

  const missing = (tables || []).filter((table) => isMissingLabel(table.title)).length;
  const listed = (tables || []).filter((table) => showAll || !isMissingLabel(table.title)).sort((a, b) => rank(a.name) - rank(b.name));
  const current = saved.find((row) => row.name.toLowerCase() === name.trim().toLowerCase());

  return (
    <div className="split-page">
      <PageHead title="Query">
        <RefreshButton label="tables" onClick={() => refreshScope("query")} />
      </PageHead>
      <p className="status">Write a SELECT and run it, or start from a sample. Pick a table on the left, then click a column to add it.</p>
      {error && <p className="error">{error}</p>}
      <div className="split">
        {chosen ? (
          <FilterRail
            key={chosen.name}
            label="Filter columns"
            placeholder="Filter columns"
            items={(fields || []).map((field) => ({ key: field.id, title: field.title, note: field.id }))}
            onPick={(column) => setSql((text) => addColumn(text, chosen.name, column))}
            loading={!fields}
            empty="This table has no plain columns."
            limit={500}
          >
            <div className="rail-head">
              <button className="linkish" type="button" onClick={() => setChosen(null)}>
                <Glyph icon={glyph.back} size={14} />
                All tables
              </button>
              <strong>{chosen.title}</strong>
            </div>
          </FilterRail>
        ) : (
          <FilterRail
            label="Filter tables"
            placeholder="Filter tables"
            items={listed.map((table) => ({ key: table.name, title: table.title, note: table.name }))}
            onPick={choose}
            loading={!tables && !error}
            empty="This role can see no tables."
          >
            {missing > 0 && (
              <label className="check rail-head">
                <input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />
                Show {missing.toLocaleString()} {missing === 1 ? "table" : "tables"} NetSuite left unlabeled
              </label>
            )}
          </FilterRail>
        )}
        <div className="split-main">
          <div className="filters">
            <span className="status">Samples</span>
            {sampleQueries.map((sample) => (
              <button
                key={sample.name}
                className="quiet"
                type="button"
                onClick={() => {
                  setSql(sample.sql);
                  setName(sample.name);
                }}
              >
                {sample.name}
              </button>
            ))}
          </div>
          <textarea
            className="code sql-editor"
            aria-label="SQL"
            spellCheck={false}
            value={sql}
            placeholder="SELECT id, entityid FROM customer"
            onChange={(event) => setSql(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                run(0);
              }
            }}
          />
          <div className="actions">
            <Button className="primary" busy={running} disabled={!sql.trim()} onClick={() => run(0)}>
              {!running && <Glyph icon={glyph.run} />}
              Run
            </Button>
            <Button className="quiet" busy={exporting} disabled={!sql.trim()} onClick={exportCsv}>
              Download CSV
            </Button>
            <span className="status">Ctrl+Enter runs the query. The CSV holds up to 5,000 rows.</span>
          </div>
          <div className="filters">
            <label>
              Saved
              <Pick
                label="Saved queries"
                value={current?.name || ""}
                placeholder={saved.length ? "Open a saved query" : "None saved yet"}
                disabled={!saved.length}
                onChange={(value) => {
                  const row = saved.find((item) => item.name === value);
                  if (!row) return;
                  setName(row.name);
                  setSql(row.sql);
                }}
                options={saved.map((row) => ({ value: row.name, label: row.name }))}
              />
            </label>
            <label>
              Name
              <input value={name} aria-label="Query name" placeholder="Open orders" onChange={(event) => setName(event.target.value)} />
            </label>
            <button className="quiet" type="button" disabled={!name.trim() || !sql.trim()} onClick={save}>
              {current ? "Save changes" : "Save"}
            </button>
            {current && (
              <button className="quiet" type="button" onClick={remove}>
                Delete
              </button>
            )}
          </div>
          {runError && <p className="error">{runError}</p>}
          {result && (
            <>
              <p className="status">
                {result.total != null ? `${result.total.toLocaleString()} rows` : `${result.rows.length} rows`}
                {result.page ? `, page ${result.page + 1}` : ""}
              </p>
              <DataTable
                label="Query results"
                wrap="plain"
                rows={result.rows}
                rowKey={(_, index) => index}
                empty="The query returned no rows."
                columns={result.columns.map((column) => ({ key: column, label: column, cell: (row: Record<string, unknown>) => orBlank(row[column]) }))}
              />
              <Pager page={result.page} hasMore={result.hasMore} onPage={(page) => run(page)} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function rank(name: string) {
  const index = commonTables.indexOf(name.toLowerCase());
  return index === -1 ? commonTables.length : index;
}
