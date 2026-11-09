import { useEffect, useRef, useState } from "react";
import { SkeletonTable } from "./load";
import { FilterRail } from "./rail";
import { RefreshButton, refreshScope } from "./refresh";
import { api } from "./api";

type TableInfo = { name: string; title: string };
type Field = { id: string; title: string; type: string };

export function QueryPage() {
  const [tables, setTables] = useState<TableInfo[] | null>(null);
  const [chosen, setChosen] = useState<TableInfo | null>(null);
  const [fields, setFields] = useState<Field[] | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  function choose(name: string) {
    const table = tables?.find((item) => item.name === name);
    if (!table) return;
    chosenRef.current = name;
    setChosen(table);
    setFields(null);
    setError(null);
    api<{ fields: Field[] }>(`/api/suiteql?type=${encodeURIComponent(table.name)}`)
      .then((body) => {
        if (chosenRef.current === name) setFields(body.fields);
      })
      .catch((reason: Error) => setError(reason.message));
  }

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
        <FilterRail
          label="Filter tables"
          placeholder="Filter tables"
          items={(tables || []).map((table) => ({ key: table.name, title: table.title, note: table.name }))}
          selected={chosen?.name}
          onPick={choose}
          loading={!tables && !error}
          empty="This role can see no tables."
        />
        <div className="split-main">
          {!chosen && <p className="split-empty">Pick a table on the left.</p>}
          {chosen && (
            <>
              <div className="pane-head">
                <strong>{chosen.title}</strong>
                <span className="status">{chosen.name}</span>
              </div>
              {!fields ? <SkeletonTable rows={8} cols={3} /> : <table>
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
              </table>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
