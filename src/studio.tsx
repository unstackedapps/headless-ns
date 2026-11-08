import { useEffect, useMemo, useRef, useState, type FormEvent, type MutableRefObject } from "react";
import { Glyph, glyph } from "./icons";
import { Markdown } from "./formatted";
import { Lookup, SkeletonTable } from "./load";
import { ConnectionPanel } from "./connect";
import { DatePick, Pick } from "./pick";
import { RefreshButton, RefreshIntervalSelect } from "./refresh";
import { ShapeSelect, ThemeSelect } from "./theme";
import { api } from "./api";

type Step = { name: string; ok: boolean; error?: string };
type PendingCall = { id: string; name: string; arguments: Record<string, unknown> };
type ChatMessage = {
  role: "user" | "assistant" | "tool";
  content?: string;
  tool_call_id?: string;
  tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[];
};
type AskResult = {
  answer: string;
  steps: Step[];
  pending: PendingCall[] | null;
  pendingId?: string;
  transcript: ChatMessage[];
};
type ToolInfo = {
  name: string;
  description: string;
  kind: "read" | "write" | "app" | "internal";
  schema: { properties?: Record<string, { type?: string | string[]; description?: string }>; required?: string[] };
};
type ReportInfo = {
  id: number;
  title: string;
  asOf: boolean;
  subsidiary: boolean;
  book: boolean;
  book2: boolean;
  context: boolean;
  nexus: boolean;
};
type Subsidiary = { id: number; name: string };
type NamedOption = { id: string; name: string };
type ReportRun = {
  title: string;
  summary: Record<string, string | number> | null;
  columns: string[];
  rows: Record<string, string | number>[];
  total: number;
  truncated: boolean;
};
type TraceEntry = { id: number; at: string; source: string; name: string; ms: number; ok: boolean; detail: string };
export type LlmConfig = {
  id?: string | null;
  configured: boolean;
  model: string;
  provider?: string;
  providerLabel?: string;
  keyMask?: string;
  baseUrl?: string;
  label?: string;
};
type ModelConnection = {
  id: string;
  label: string;
  provider: string;
  providerLabel: string;
  model: string;
  baseUrl: string;
  configured: boolean;
  keyMask: string;
};
type ProviderChoice = { id: string; label: string; defaultModel: string; needsBaseUrl: boolean };
type ModelsPayload = { activeId: string | null; connections: ModelConnection[]; providers: ProviderChoice[] };
type Policy = { allowWrites: boolean; disabled: string[] };
type Config = {
  accountId: string;
  roleId: string;
  roleCenter: string;
  environment: string;
  version: string;
  features: string[];
  permissions: Record<string, string[]>;
  llm: LlmConfig;
  models: ModelsPayload;
  policy: Policy;
};

const kindLabel: Record<ToolInfo["kind"], string> = {
  read: "Read",
  write: "Change",
  app: "Chat",
  internal: "File",
};

function today() {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function yearStart() {
  return `${new Date().getFullYear()}-01-01`;
}

function visibleThread(transcript: ChatMessage[]) {
  return transcript.filter((message) => (message.role === "user" || message.role === "assistant") && message.content);
}

export function AskPage({
  docked = false,
  onLlm,
  clearRef,
  onDirty,
}: {
  docked?: boolean;
  onLlm?: (llm: LlmConfig) => void;
  clearRef?: MutableRefObject<(() => void) | null>;
  onDirty?: (dirty: boolean) => void;
}) {
  const [transcript, setTranscript] = useState<ChatMessage[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [pending, setPending] = useState<PendingCall[] | null>(null);
  const [pendingId, setPendingId] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [llm, setLlm] = useState<LlmConfig | null>(null);
  const [models, setModels] = useState<ModelsPayload | null>(null);
  const turn = useRef(0);
  const dirty = transcript.length > 0 || Boolean(text.trim()) || Boolean(error) || Boolean(pending?.length) || busy;

  function clear() {
    turn.current += 1;
    setTranscript([]);
    setSteps([]);
    setPending(null);
    setPendingId("");
    setText("");
    setError(null);
    setBusy(false);
  }

  if (clearRef) clearRef.current = clear;

  useEffect(() => {
    onDirty?.(dirty);
  }, [dirty, onDirty]);

  useEffect(() => {
    let live = true;
    function applyLlm(next: LlmConfig) {
      if (!live) return;
      setLlm(next);
      onLlm?.(next);
    }
    api<Config>("/api/config")
      .then((config) => {
        applyLlm(config.llm);
        setModels(config.models);
      })
      .catch(() => {
        if (live) setLlm(null);
      });
    function onSaved(event: Event) {
      const detail = (event as CustomEvent<LlmConfig>).detail;
      if (detail?.model) applyLlm(detail);
    }
    window.addEventListener("hn-llm", onSaved);
    return () => {
      live = false;
      window.removeEventListener("hn-llm", onSaved);
    };
  }, [onLlm]);

  async function apply(result: AskResult) {
    setTranscript(result.transcript);
    setSteps(result.steps);
    setPending(result.pending);
    setPendingId(result.pendingId || "");
  }

  async function send(question: string) {
    const trimmed = question.trim();
    if (!trimmed || busy) return;
    const id = turn.current;
    setBusy(true);
    setError(null);
    setPending(null);
    setText("");
    try {
      const result = await api<AskResult>("/api/ask", { method: "POST", body: JSON.stringify({ text: trimmed, transcript }) });
      if (turn.current !== id) return;
      apply(result);
    } catch (reason) {
      if (turn.current !== id) return;
      setError(reason instanceof Error ? reason.message : "The question failed.");
    } finally {
      if (turn.current === id) setBusy(false);
    }
  }

  async function decide(approved: boolean) {
    const id = turn.current;
    setBusy(true);
    setError(null);
    try {
      const result = await api<AskResult>("/api/ask/confirm", {
        method: "POST",
        body: JSON.stringify({ id: pendingId, approved }),
      });
      if (turn.current !== id) return;
      apply(result);
    } catch (reason) {
      if (turn.current !== id) return;
      setError(reason instanceof Error ? reason.message : "The confirmation failed.");
    } finally {
      if (turn.current === id) setBusy(false);
    }
  }

  const thread = visibleThread(transcript);

  const form = (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        send(text);
      }}
    >
      <textarea
        value={text}
        placeholder="Ask about this account"
        aria-label="Question"
        rows={1}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          send(text);
        }}
      />
      <button className="primary icon-btn" type="submit" disabled={busy || !text.trim()} aria-label="Ask">
        <Glyph icon={glyph.send} />
      </button>
    </form>
  );

  const modelPick = (
    <div className="status ask-model">
      {models && models.connections.length > 0 ? (
        <Pick
          label="Model"
          value={llm?.id || models.activeId || ""}
          onChange={(id) => {
            api<ModelsPayload>("/api/models/active", { method: "POST", body: JSON.stringify({ id }) })
              .then((next) => {
                setModels(next);
                const active = next.connections.find((row) => row.id === next.activeId);
                if (!active) return;
                const chosen: LlmConfig = {
                  id: active.id,
                  configured: active.configured,
                  model: active.model,
                  provider: active.provider,
                  providerLabel: active.providerLabel,
                  keyMask: active.keyMask,
                  baseUrl: active.baseUrl,
                  label: active.label,
                };
                setLlm(chosen);
                onLlm?.(chosen);
                window.dispatchEvent(new CustomEvent<LlmConfig>("hn-llm", { detail: chosen }));
              })
              .catch((reason: Error) => setError(reason.message));
          }}
          options={models.connections.map((row) => ({ value: row.id, label: `${row.label} · ${row.model}` }))}
        />
      ) : llm?.configured ? (
        `Using ${llm.model}.`
      ) : llm ? (
        "No model key yet. Add one under Settings."
      ) : (
        "Looking up the model."
      )}
    </div>
  );

  const conversation = (
    <>
      {!docked && (
        <header className="page-head">
          <div>
            <div className="kicker">Assistant</div>
            <h1>Ask</h1>
          </div>
          <button className="quiet" type="button" disabled={!dirty} onClick={clear}>
            Clear
          </button>
        </header>
      )}
      <div className="thread">
        {thread.map((message, index) => (
          <div key={`${message.role}-${index}`} className={message.role === "user" ? "bubble user" : "bubble"}>
            {message.role === "assistant" && message.content ? <Markdown text={message.content} /> : <div>{message.content}</div>}
            {message.role === "assistant" && index === thread.length - 1 && steps.length > 0 && (
              <ul className="steps">
                {steps.map((step, stepIndex) => (
                  <li key={`${step.name}-${stepIndex}`}>
                    {step.ok ? "Ran" : "Failed"} {step.name}
                    {step.error ? ` — ${step.error}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {busy && <Lookup label="Looking that up." />}
      </div>
      {error && <p className="error">{error}</p>}
      {pending && pending.length > 0 && (
        <section className="panel">
          <h2>Confirm before this runs on NetSuite</h2>
          {pending.map((call) => (
            <div key={call.id}>
              <p>
                <code>{call.name}</code>
              </p>
              <pre className="result">{JSON.stringify(call.arguments, null, 2)}</pre>
            </div>
          ))}
          <div className="actions">
            <button className="primary" type="button" disabled={busy} onClick={() => decide(true)}>
              Run on NetSuite
            </button>
            <button className="quiet" type="button" disabled={busy} onClick={() => decide(false)}>
              Cancel
            </button>
          </div>
        </section>
      )}
      {docked ? null : form}
      {docked ? null : modelPick}
    </>
  );

  if (docked) {
    return (
      <>
        <div className="ask-scroll">{conversation}</div>
        {form}
        {modelPick}
      </>
    );
  }

  return conversation;
}

function fieldType(spec: { type?: string | string[] }) {
  const value = Array.isArray(spec.type) ? spec.type.find((item) => item !== "null") : spec.type;
  return value || "string";
}

export function WorkbenchPage() {
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [raw, setRaw] = useState("");
  const [jsonMode, setJsonMode] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stop = false;
    function load() {
      api<{ tools: ToolInfo[] }>("/api/tools")
        .then((body) => {
          if (stop) return;
          setTools(body.tools);
          setSelected((current) => (body.tools.some((item) => item.name === current) ? current : body.tools[0]?.name || ""));
          setLoadError(null);
        })
        .catch((reason: Error) => {
          if (!stop) setLoadError(reason.message);
        })
        .finally(() => {
          if (!stop) setReady(true);
        });
    }
    load();
    const onRefresh = (event: Event) => {
      const scope = (event as CustomEvent<{ scope?: string }>).detail?.scope;
      if (!scope || scope === "workbench") load();
    };
    window.addEventListener("hn-refresh", onRefresh);
    return () => {
      stop = true;
      window.removeEventListener("hn-refresh", onRefresh);
    };
  }, []);

  const tool = tools.find((item) => item.name === selected) || null;
  const fields = useMemo(() => {
    const properties = tool?.schema.properties || {};
    const required = new Set(tool?.schema.required || []);
    return Object.entries(properties).map(([name, spec]) => ({
      name,
      type: fieldType(spec),
      required: required.has(name),
      hint: (spec.description || "").slice(0, 160),
    }));
  }, [tool]);

  const shown = tools.filter((item) => item.name.toLowerCase().includes(query.trim().toLowerCase()));
  const needsConfirm = tool ? tool.kind !== "read" : false;

  function argumentsFor() {
    if (jsonMode) return raw.trim() ? JSON.parse(raw) : {};
    const args: Record<string, unknown> = {};
    for (const field of fields) {
      const value = values[field.name] ?? "";
      if (value === "") continue;
      if (field.type === "number") args[field.name] = Number(value);
      else if (field.type === "boolean") args[field.name] = value === "true";
      else args[field.name] = value;
    }
    return args;
  }

  async function run() {
    if (!tool || busy) return;
    setBusy(true);
    setError(null);
    try {
      const body = await api<{ ms: number; result: unknown }>("/api/workbench", {
        method: "POST",
        body: JSON.stringify({ name: tool.name, arguments: argumentsFor(), confirm }),
      });
      setResult(`${body.ms} ms\n${JSON.stringify(body.result, null, 2)}`);
    } catch (reason) {
      setResult("");
      setError(reason instanceof Error ? reason.message : "The call failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!ready && !loadError) {
    return (
      <>
        <header className="page-head">
          <div>
            <div className="kicker">Tools</div>
            <h1>Workbench</h1>
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
          <div className="kicker">Tools</div>
          <h1>Workbench</h1>
        </div>
        <RefreshButton label="tools" scope="workbench" />
      </header>
      {loadError && <p className="error">{loadError}</p>}
      {ready && <div className="split">
        <div className="split-rail">
          <label className="search-field">
            <Glyph icon={glyph.search} size={14} />
            <input className="search" value={query} placeholder="Filter tools" aria-label="Filter tools" onChange={(event) => setQuery(event.target.value)} />
          </label>
          <div className="tool-list">
            {shown.map((item) => (
              <button
                key={item.name}
                type="button"
                className={item.name === selected ? "tool on" : "tool"}
                onClick={() => {
                  setSelected(item.name);
                  setValues({});
                  setRaw("");
                  setConfirm(false);
                  setResult("");
                  setError(null);
                }}
              >
                <span>{item.name}</span>
                <em>{kindLabel[item.kind]}</em>
              </button>
            ))}
          </div>
        </div>
        {tool && (
          <div className="split-main">
            <h2>{tool.name}</h2>
            <p className="status">{tool.description}</p>
            <label className="check">
              <input type="checkbox" checked={jsonMode} onChange={(event) => setJsonMode(event.target.checked)} />
              Edit arguments as JSON
            </label>
            {jsonMode ? (
              <textarea className="code" aria-label="Arguments JSON" value={raw} placeholder="{}" onChange={(event) => setRaw(event.target.value)} />
            ) : (
              <div className="form">
                {fields.map((field) => (
                  <label key={field.name}>
                    {field.name}
                    {field.required ? " (required)" : ""}
                    {field.type === "boolean" ? (
                      <Pick
                        label={field.name}
                        value={values[field.name] || "unset"}
                        onChange={(next) => setValues({ ...values, [field.name]: next === "unset" ? "" : next })}
                        options={[
                          { value: "unset", label: "Leave unset" },
                          { value: "true", label: "true" },
                          { value: "false", label: "false" },
                        ]}
                      />
                    ) : (
                      <input
                        type={field.type === "number" ? "number" : "text"}
                        value={values[field.name] || ""}
                        onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
                      />
                    )}
                    {field.hint ? <span className="note">{field.hint}</span> : null}
                  </label>
                ))}
              </div>
            )}
            {needsConfirm && (
              <label className="check">
                <input type="checkbox" checked={confirm} onChange={(event) => setConfirm(event.target.checked)} />
                I mean to run this. It can change NetSuite.
              </label>
            )}
            <div className="actions">
              <button className="primary" type="button" disabled={busy} onClick={run}>
                <Glyph icon={glyph.run} />
                {busy ? "Running" : "Run"}
              </button>
            </div>
            {error && <p className="error">{error}</p>}
            {result && <pre className="result">{result}</pre>}
          </div>
        )}
      </div>}
    </div>
  );
}

export function ReportsPage() {
  const [reports, setReports] = useState<ReportInfo[]>([]);
  const [subsidiaries, setSubsidiaries] = useState<Subsidiary[]>([]);
  const [books, setBooks] = useState<NamedOption[]>([]);
  const [contexts, setContexts] = useState<NamedOption[]>([]);
  const [nexuses, setNexuses] = useState<NamedOption[]>([]);
  const [reportId, setReportId] = useState<number | "">("");
  const [subsidiaryId, setSubsidiaryId] = useState<number | "">("");
  const [book, setBook] = useState("");
  const [book2, setBook2] = useState("");
  const [accountingContext, setAccountingContext] = useState("");
  const [nexusId, setNexusId] = useState("");
  const [dateFrom, setDateFrom] = useState(yearStart);
  const [dateTo, setDateTo] = useState(today);
  const [run, setRun] = useState<ReportRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stop = false;
    function load() {
      api<{ reports: ReportInfo[]; subsidiaries: Subsidiary[]; books: NamedOption[]; contexts: NamedOption[]; nexuses: NamedOption[] }>("/api/reports")
        .then((body) => {
          if (stop) return;
          setReports(body.reports);
          setSubsidiaries(body.subsidiaries);
          setBooks(body.books || []);
          setContexts(body.contexts || []);
          setNexuses(body.nexuses || []);
          setReportId((current) => {
            if (current !== "" && body.reports.some((item) => item.id === current)) return current;
            return (body.reports.find((item) => item.id === 256) || body.reports[0])?.id ?? "";
          });
          setSubsidiaryId((current) => {
            if (current !== "" && body.subsidiaries.some((item) => item.id === current)) return current;
            return body.subsidiaries.find((item) => item.name === "United States")?.id ?? body.subsidiaries[0]?.id ?? "";
          });
          setError(null);
        })
        .catch((reason: Error) => {
          if (!stop) setError(reason.message);
        })
        .finally(() => {
          if (!stop) setReady(true);
        });
    }
    load();
    const onRefresh = (event: Event) => {
      const scope = (event as CustomEvent<{ scope?: string }>).detail?.scope;
      if (!scope || scope === "reports") load();
    };
    window.addEventListener("hn-refresh", onRefresh);
    return () => {
      stop = true;
      window.removeEventListener("hn-refresh", onRefresh);
    };
  }, []);

  const report = reports.find((item) => item.id === reportId);

  async function execute() {
    if (reportId === "" || busy) return;
    setBusy(true);
    setError(null);
    try {
      setRun(
        await api<ReportRun>("/api/reports/run", {
          method: "POST",
          body: JSON.stringify({ reportId, subsidiaryId, dateFrom, dateTo, book, book2, accountingContext, nexusId }),
        }),
      );
    } catch (reason) {
      setRun(null);
      setError(reason instanceof Error ? reason.message : "The report failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!ready && !error) {
    return (
      <>
        <header className="page-head">
          <div>
            <div className="kicker">Saved reports</div>
            <h1>Reports</h1>
          </div>
        </header>
        <SkeletonTable rows={8} cols={3} />
      </>
    );
  }

  return (
    <>
      <header className="page-head">
        <div>
          <div className="kicker">Saved reports</div>
          <h1>Reports</h1>
        </div>
        <RefreshButton label="reports" scope="reports" />
      </header>
      <p className="status">{reports.length} reports for this role.</p>
      {ready && <div className="filters">
        <label>
          Report
          <Pick
            label="Report"
            value={reportId === "" ? "" : String(reportId)}
            onChange={(next) => setReportId(Number(next))}
            options={reports.map((item) => ({ value: String(item.id), label: item.title }))}
          />
        </label>
        {report?.subsidiary && (
          <label>
            Subsidiary
            <Pick
              label="Subsidiary"
              value={subsidiaryId === "" ? "" : String(subsidiaryId)}
              onChange={(next) => setSubsidiaryId(Number(next))}
              options={subsidiaries.map((item) => ({ value: String(item.id), label: item.name }))}
            />
          </label>
        )}
        {report?.book && books.length > 0 && (
          <label>
            Book
            <Pick
              label="Book"
              value={book || "any"}
              onChange={(next) => setBook(next === "any" ? "" : next)}
              options={[{ value: "any", label: "Any" }, ...books.map((item) => ({ value: item.id, label: item.name }))]}
            />
          </label>
        )}
        {report?.book2 && books.length > 0 && (
          <label>
            Second book
            <Pick
              label="Second book"
              value={book2 || "any"}
              onChange={(next) => setBook2(next === "any" ? "" : next)}
              options={[{ value: "any", label: "Any" }, ...books.map((item) => ({ value: item.id, label: item.name }))]}
            />
          </label>
        )}
        {report?.context && contexts.length > 0 && (
          <label>
            Context
            <Pick
              label="Context"
              value={accountingContext || "any"}
              onChange={(next) => setAccountingContext(next === "any" ? "" : next)}
              options={[{ value: "any", label: "Any" }, ...contexts.map((item) => ({ value: item.id, label: item.name }))]}
            />
          </label>
        )}
        {report?.nexus && nexuses.length > 0 && (
          <label>
            Nexus
            <Pick
              label="Nexus"
              value={nexusId || "any"}
              onChange={(next) => setNexusId(next === "any" ? "" : next)}
              options={[{ value: "any", label: "Any" }, ...nexuses.map((item) => ({ value: item.id, label: item.name }))]}
            />
          </label>
        )}
        {!report?.asOf && (
          <label>
            From
            <DatePick label="From" value={dateFrom} onChange={setDateFrom} />
          </label>
        )}
        <label>
          To
          <DatePick label="To" value={dateTo} onChange={setDateTo} />
        </label>
        <button className="primary" type="button" disabled={busy || reportId === ""} onClick={execute}>
          <Glyph icon={glyph.run} />
          {busy ? "Running" : "Run report"}
        </button>
      </div>}
      {busy && (
        <section className="list-view">
          <Lookup label="Running the report." />
          <SkeletonTable rows={6} cols={4} />
        </section>
      )}
      {error && <p className="error">{error}</p>}
      {run && !busy && (
        <section className="section">
          <header className="page-head">
            <h2>{run.title}</h2>
            <RefreshButton label="report result" onClick={execute} busy={busy} />
          </header>
          {run.summary && (
            <p className="status">
              Summary:{" "}
              {Object.entries(run.summary)
                .filter(([, value]) => value !== "" && value != null)
                .map(([key, value]) => `${key} ${value}`)
                .join(" · ")}
            </p>
          )}
          <p className="status">
            {run.total} detail lines{run.truncated ? ", showing the first 200" : ""}.
          </p>
          <div className="table-wrap loose">
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
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

export function TracePage() {
  const [entries, setEntries] = useState<TraceEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const body = await api<{ entries: TraceEntry[] }>("/api/trace");
        if (!stop) {
          setEntries(body.entries);
          setError(null);
        }
      } catch (reason) {
        if (!stop) setError(reason instanceof Error ? reason.message : "The trace failed.");
      } finally {
        if (!stop) setReady(true);
      }
    }
    load();
    const timer = setInterval(load, 4000);
    const onRefresh = (event: Event) => {
      const scope = (event as CustomEvent<{ scope?: string }>).detail?.scope;
      if (!scope || scope === "trace") load();
    };
    window.addEventListener("hn-refresh", onRefresh);
    return () => {
      stop = true;
      clearInterval(timer);
      window.removeEventListener("hn-refresh", onRefresh);
    };
  }, []);

  if (!ready) {
    return (
      <>
        <header className="page-head">
          <div>
            <div className="kicker">Audit</div>
            <h1>Trace</h1>
          </div>
        </header>
        <SkeletonTable rows={8} cols={4} />
      </>
    );
  }

  return (
    <>
      <header className="page-head">
        <div>
          <div className="kicker">Audit</div>
          <h1>Trace</h1>
        </div>
        <RefreshButton label="trace" scope="trace" />
      </header>
      <p className="status">Recent calls. This list updates on its own.</p>
      {error && <p className="error">{error}</p>}
      <div className="table-wrap loose">
        <table>
          <thead>
            <tr>
              <th className="when">When</th>
              <th>Source</th>
              <th>Tool</th>
              <th className="num">ms</th>
              <th>Result</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td className="when">{new Date(entry.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}</td>
                <td>{entry.source}</td>
                <td>{entry.name}</td>
                <td className="num">{entry.ms}</td>
                <td>{entry.ok ? "Ok" : "Failed"}</td>
                <td>{entry.detail || "—"}</td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={6} className="empty">
                  No calls yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function SettingsPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [models, setModels] = useState<ModelsPayload | null>(null);
  const [draft, setDraft] = useState({ id: "", label: "", provider: "openai", model: "gpt-5.2", baseUrl: "", apiKey: "" });
  const [allowWrites, setAllowWrites] = useState(false);
  const [disabled, setDisabled] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const policyReady = useRef(false);

  useEffect(() => {
    let stop = false;
    function load(resetPolicy: boolean) {
      Promise.all([api<Config>("/api/config"), api<{ tools: ToolInfo[] }>("/api/tools")])
        .then(([next, catalog]) => {
          if (stop) return;
          setConfig(next);
          setTools(catalog.tools);
          setModels(next.models);
          if (resetPolicy || !policyReady.current) {
            setAllowWrites(next.policy.allowWrites);
            setDisabled(next.policy.disabled);
            policyReady.current = true;
          }
        })
        .catch((reason: Error) => {
          if (!stop) setError(reason.message);
        });
    }
    load(true);
    const onRefresh = (event: Event) => {
      const scope = (event as CustomEvent<{ scope?: string }>).detail?.scope;
      if (!scope || scope === "settings") load(false);
    };
    window.addEventListener("hn-refresh", onRefresh);
    return () => {
      stop = true;
      window.removeEventListener("hn-refresh", onRefresh);
    };
  }, []);

  function chooseConnection(id: string) {
    const row = models?.connections.find((item) => item.id === id);
    const provider = models?.providers.find((item) => item.id === (row?.provider || "openai"));
    setDraft({
      id: row?.id || "",
      label: row?.label || "",
      provider: row?.provider || "openai",
      model: row?.model || provider?.defaultModel || "",
      baseUrl: row?.baseUrl || "",
      apiKey: "",
    });
    setMessage(null);
    setError(null);
  }

  function llmFrom(payload: ModelsPayload): LlmConfig | null {
    const active = payload.connections.find((row) => row.id === payload.activeId);
    if (!active) return null;
    return {
      id: active.id,
      configured: active.configured,
      model: active.model,
      provider: active.provider,
      providerLabel: active.providerLabel,
      keyMask: active.keyMask,
      baseUrl: active.baseUrl,
      label: active.label,
    };
  }

  async function saveModel(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const next = await api<ModelsPayload>("/api/models", { method: "POST", body: JSON.stringify(draft) });
      setModels(next);
      setDraft((current) => ({ ...current, apiKey: "" }));
      const llm = llmFrom(next);
      if (llm) {
        setConfig((current) => (current ? { ...current, llm, models: next } : current));
        window.dispatchEvent(new CustomEvent<LlmConfig>("hn-llm", { detail: llm }));
      }
      const saved = next.connections.find((row) => row.model === draft.model && row.provider === draft.provider);
      if (saved) setDraft((current) => ({ ...current, id: saved.id, apiKey: "" }));
      setMessage(saved?.keyMask ? `Saved. Key ${saved.keyMask}.` : "Saved.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the model.");
    } finally {
      setBusy(false);
    }
  }

  async function activate(id: string) {
    setBusy(true);
    setError(null);
    try {
      const next = await api<ModelsPayload>("/api/models/active", { method: "POST", body: JSON.stringify({ id }) });
      setModels(next);
      const llm = llmFrom(next);
      if (llm) {
        setConfig((current) => (current ? { ...current, llm, models: next } : current));
        window.dispatchEvent(new CustomEvent<LlmConfig>("hn-llm", { detail: llm }));
      }
      setMessage("Ask now uses this model.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not switch models.");
    } finally {
      setBusy(false);
    }
  }

  async function removeModel(id: string) {
    setBusy(true);
    setError(null);
    try {
      const next = await api<ModelsPayload>("/api/models/remove", { method: "POST", body: JSON.stringify({ id }) });
      setModels(next);
      if (draft.id === id) chooseConnection("");
      const llm = llmFrom(next);
      if (llm) window.dispatchEvent(new CustomEvent<LlmConfig>("hn-llm", { detail: llm }));
      setMessage("Removed.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not remove the model.");
    } finally {
      setBusy(false);
    }
  }

  async function testModel() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const body = await api<{ reply: string }>("/api/models/test", {
        method: "POST",
        body: JSON.stringify({ id: draft.id || models?.activeId }),
      });
      setMessage(`The model replied: ${body.reply}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The model test failed.");
    } finally {
      setBusy(false);
    }
  }

  async function savePolicy() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const policy = await api<Policy>("/api/config/policy", {
        method: "POST",
        body: JSON.stringify({ allowWrites, disabled }),
      });
      setMessage(policy.allowWrites ? "Changes are allowed. Ask still waits for you to confirm." : "Ask can only read.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the tool policy.");
    } finally {
      setBusy(false);
    }
  }

  const assistantTools = tools.filter((tool) => tool.kind === "read" || tool.kind === "write");

  return (
    <>
      <header className="page-head">
        <div>
          <div className="kicker">Setup</div>
          <h1>Settings</h1>
        </div>
        <RefreshButton label="settings" scope="settings" />
      </header>
      {error && <p className="error">{error}</p>}
      {message && <p className="status">{message}</p>}
      <section className="section">
        <h2>Connection</h2>
        <p className="status">The token is not stored in the browser.</p>
        <ConnectionPanel />
      </section>
      <section className="section">
        <h2>Appearance</h2>
        <p className="status">This browser remembers the theme, the corners, and the refresh timer.</p>
        <div className="appearance">
          <ThemeSelect labelled />
          <ShapeSelect labelled />
          <RefreshIntervalSelect />
        </div>
      </section>
      {!config && !error && <SkeletonTable rows={4} cols={2} />}
      {config && (
        <section className="section">
          <h2>Account</h2>
          <div className="panel">
            <p>
              {config.accountId} · {config.roleId} · {config.roleCenter}
            </p>
            <p className="status">
              {config.environment} {config.version} · model {config.llm.configured ? config.llm.keyMask : "not connected"}
            </p>
          </div>
        </section>
      )}
      {config && (
        <section className="section">
          <h2>Permissions</h2>
          <div className="perm-grid">
            {Object.entries(config.permissions).map(([level, ids]) => (
              <div key={level} className="panel">
                <h3>{level}</h3>
                {ids.length === 0 ? (
                  <p className="status">None granted.</p>
                ) : (
                  <ul className="perm-list">
                    {ids.map((id) => (
                      <li key={id}>{id}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
      {config && (
        <section className="section">
          <h2>Features</h2>
          <details className="panel">
            <summary>{config.features.length} enabled</summary>
            <p className="status">{config.features.join(", ")}</p>
          </details>
        </section>
      )}
      <section className="section">
        <h2>Models</h2>
        <p className="status">The key is not stored in the browser. Leave the field blank to keep the saved key.</p>
        {models && models.connections.length > 0 && (
          <ul className="model-list">
            {models.connections.map((row) => (
              <li key={row.id}>
                <button className={row.id === models.activeId ? "quiet on" : "quiet"} type="button" onClick={() => activate(row.id)}>
                  {row.id === models.activeId ? "In use" : "Use"}
                </button>
                <button className="linkish" type="button" onClick={() => chooseConnection(row.id)}>
                  {row.label} · {row.providerLabel} · {row.model}
                </button>
                <span className="note">{row.keyMask}</span>
                <button className="quiet" type="button" onClick={() => removeModel(row.id)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <form className="form" onSubmit={saveModel}>
          <label>
            Name
            <input value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} />
          </label>
          <label>
            Provider
            <Pick
              label="Provider"
              value={draft.provider}
              onChange={(next) => {
                const spec = models?.providers.find((item) => item.id === next);
                setDraft({ ...draft, provider: next, model: draft.id ? draft.model : spec?.defaultModel || "" });
              }}
              options={(models?.providers || []).map((item) => ({ value: item.id, label: item.label }))}
            />
          </label>
          <label>
            Model
            <input value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} />
          </label>
          {models?.providers.find((item) => item.id === draft.provider)?.needsBaseUrl && (
            <label>
              Base URL
              <input value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} />
            </label>
          )}
          <label>
            API key
            <input
              type="password"
              value={draft.apiKey}
              autoComplete="off"
              placeholder={models?.connections.find((row) => row.id === draft.id)?.keyMask || "API key"}
              onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
            />
          </label>
          <div className="actions">
            <button className="primary" type="submit" disabled={busy}>
              {draft.id ? "Save model" : "Add model"}
            </button>
            <button className="quiet" type="button" disabled={busy || !(draft.id || models?.activeId)} onClick={testModel}>
              Test model
            </button>
            {draft.id && (
              <button className="quiet" type="button" onClick={() => chooseConnection("")}>
                New model
              </button>
            )}
          </div>
        </form>
      </section>
      <section className="section">
        <h2>Assistant</h2>
        <label className="check">
          <input type="checkbox" checked={allowWrites} onChange={(event) => setAllowWrites(event.target.checked)} />
          Allow changes. Ask still waits for you to confirm.
        </label>
        <div className="tool-picks">
          {assistantTools.map((tool) => {
            const on = !disabled.includes(tool.name) && (tool.kind === "read" || allowWrites);
            return (
              <label key={tool.name} className="check">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={tool.kind === "write" && !allowWrites}
                  onChange={(event) => {
                    setDisabled((current) =>
                      event.target.checked ? current.filter((name) => name !== tool.name) : [...current, tool.name],
                    );
                  }}
                />
                {tool.name}
                <em>{kindLabel[tool.kind]}</em>
              </label>
            );
          })}
        </div>
        <button className="primary" type="button" disabled={busy} onClick={savePolicy}>
          Save tool policy
        </button>
      </section>
    </>
  );
}
