import { useEffect, useState } from "react";
import { Glyph, glyph } from "./icons";
import { RefreshButton, refreshScope } from "./refresh";

type TableInfo = { name: string; title: string };
type Field = { id: string; title: string; type: string };

async function api<T>(path: string): Promise<T> {
  const response = await fetch(path);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body as T;
}

export function QueryPage() {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<TableInfo | null>(null);
  const [fields, setFields] = useState<Field[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    function load() {
      api<{ tables: TableInfo[] }>("/api/suiteql")
        .then((body) => {
          if (!stop) setTables(body.tables);
        })
        .catch((reason: Error) => {
          if (!stop) setError(reason.message);
        });
    }
    load();
    const onRefresh = (event: Event) => {
      const scope = (event as CustomEvent<{ scope?: string }>).detail?.scope;
      if (!scope || scope === "query") load();
    };
    window.addEventListener("hn-refresh", onRefresh);
    return () => {
      stop = true;
      window.removeEventListener("hn-refresh", onRefresh);
    };
  }, []);

  function choose(table: TableInfo) {
    setChosen(table);
    setError(null);
    api<{ fields: Field[] }>(`/api/suiteql?type=${encodeURIComponent(table.name)}`)
      .then((body) => setFields(body.fields))
      .catch((reason: Error) => setError(reason.message));
  }

  const shown = tables.filter((table) => `${table.title} ${table.name}`.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className="split-page">
      <header className="page-head">
        <div>
          <div className="kicker">SuiteQL</div>
          <h1>Query</h1>
        </div>
        <RefreshButton label="query guide" onClick={() => refreshScope("query")} />
      </header>
      <p className="status">Pick a table to see the columns you can query.</p>
      {error && <p className="error">{error}</p>}
      <div className="split">
        <div className="split-rail">
          <label className="search-field">
            <Glyph icon={glyph.search} size={14} />
            <input className="search" value={query} placeholder="Filter tables" aria-label="Filter tables" onChange={(event) => setQuery(event.target.value)} />
          </label>
          <div className="tool-list">
            {shown.map((table) => (
              <button key={table.name} type="button" className={chosen?.name === table.name ? "tool on" : "tool"} onClick={() => choose(table)}>
                <span>{table.title}</span>
                <em>{table.name}</em>
              </button>
            ))}
          </div>
        </div>
        <div className="split-main">
          {!chosen && <p className="split-empty">Pick a table on the left.</p>}
          {chosen && (
            <>
              <div className="pane-head">
                <strong>{chosen.title}</strong>
                <span className="status">{chosen.name}</span>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Column</th>
                    <th>Id</th>
                    <th>Type</th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((field) => (
                    <tr key={field.id}>
                      <td>{field.title}</td>
                      <td>{field.id}</td>
                      <td>{field.type}</td>
                    </tr>
                  ))}
                  {fields.length === 0 && (
                    <tr>
                      <td className="empty" colSpan={3}>
                        This table has no plain columns.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
