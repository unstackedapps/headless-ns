import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { portletCatalog, readLayout, resetLayout, widthWord } from "./layout";
import { Glyph, glyph } from "./icons";
import { Tip } from "./pick";
import { AskPage, type LlmConfig } from "./studio";
import { themes, useTheme } from "./theme";

const screens = [
  "overview",
  "customers",
  "orders",
  "quotes",
  "invoices",
  "bills",
  "items",
  "people",
  "reports",
  "workbench",
  "trace",
  "settings",
] as const;

type Line = { id: number; tone: "in" | "out" | "err"; text: string };

const help = [
  "open <screen>    Open a screen",
  "theme <name>     Switch theme. Light: ledger, paper, day. Dark: ink, graphite, night",
  "themes           List themes",
  "sql <select>     Run one SuiteQL SELECT",
  "ask <question>   Ask the model. A NetSuite change is not posted from here",
  "who              Show the account and role",
  "layout           Show the home cards",
  "layout reset     Restore the home cards",
  "clear            Clear this panel",
  "help             Show this list",
].join("\n");

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
  return payload as T;
}

function clip(value: string, width: number) {
  if (value.length > width) return `${value.slice(0, Math.max(1, width - 1))}…`;
  return value.padEnd(width);
}

function asTable(columns: string[], rows: Record<string, unknown>[]) {
  const widths = columns.map((column) =>
    Math.min(28, Math.max(column.length, ...rows.map((row) => String(row[column] ?? "").length))),
  );
  const line = (row: Record<string, unknown> | null) =>
    columns.map((column, index) => clip(row ? String(row[column] ?? "") : column, widths[index])).join("  ");
  return [line(null), ...rows.map((row) => line(row))].join("\n");
}

export function AskDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [llm, setLlm] = useState<LlmConfig | null>(null);
  const [dirty, setDirty] = useState(false);
  const clearRef = useRef<(() => void) | null>(null);
  const label = llm ? (llm.configured ? llm.model : "No key") : "";

  return (
    <aside className={open ? "ask-drawer open" : "ask-drawer"} aria-hidden={!open} inert={!open} aria-label="Ask">
      <header className="drawer-bar">
        <strong>Ask</strong>
        {label && (
          <Tip label={label} side="bottom">
            <span className={llm?.configured ? "chip" : "chip off"}>{label}</span>
          </Tip>
        )}
        <div className="bar-actions">
          <button className="quiet" type="button" disabled={!dirty} onClick={() => clearRef.current?.()}>
            <Glyph icon={glyph.clear} size={14} />
            Clear
          </button>
          <button className="quiet" type="button" onClick={onClose}>
            <Glyph icon={glyph.close} size={14} />
            Close
          </button>
        </div>
      </header>
      <AskPage docked onLlm={setLlm} clearRef={clearRef} onDirty={setDirty} />
    </aside>
  );
}

export function CommandLine({
  open,
  onClose,
  onNavigate,
}: {
  open: boolean;
  onClose: () => void;
  onNavigate: (screen: string) => void;
}) {
  const [theme, setTheme] = useTheme();
  const [minimized, setMinimized] = useState(false);
  const [height, setHeight] = useState(() => Number(localStorage.getItem("hn-shell-h")) || 280);
  const [dragging, setDragging] = useState(false);
  const [lines, setLines] = useState<Line[]>([{ id: 1, tone: "out", text: "headless-ns command line. Type help." }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const history = useRef<string[]>([]);
  const cursor = useRef(0);
  const draft = useRef("");
  const nextId = useRef(2);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dock = !open ? "0px" : minimized ? "40px" : `${height}px`;

  useEffect(() => {
    document.documentElement.style.setProperty("--dock", dock);
  }, [dock]);

  useEffect(() => {
    if (open && !minimized) inputRef.current?.focus();
  }, [open, minimized]);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [lines, busy]);

  function push(tone: Line["tone"], text: string) {
    const id = nextId.current++;
    setLines((current) => [...current, { id, tone, text }].slice(-200));
  }

  function startResize(event: ReactPointerEvent) {
    if (minimized) return;
    const startY = event.clientY;
    const startH = height;
    setDragging(true);
    const move = (ev: PointerEvent) => {
      const next = Math.min(window.innerHeight - 80, Math.max(160, startH + (startY - ev.clientY)));
      setHeight(next);
      localStorage.setItem("hn-shell-h", String(next));
    };
    const stop = () => {
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }

  async function run(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed || busy) return;
    history.current.push(trimmed);
    cursor.current = history.current.length;
    draft.current = "";
    setInput("");
    push("in", trimmed);
    const space = trimmed.indexOf(" ");
    const name = (space === -1 ? trimmed : trimmed.slice(0, space)).toLowerCase();
    const rest = space === -1 ? "" : trimmed.slice(space + 1).trim();
    try {
      if (name === "help") {
        push("out", help);
        return;
      }
      if (name === "clear") {
        setLines([]);
        return;
      }
      if (name === "themes") {
        push("out", themes.map((item) => `${item.label.padEnd(10)} ${item.tone}`).join("\n"));
        return;
      }
      if (name === "theme") {
        if (!rest) {
          const current = themes.find((item) => item.id === theme);
          push("out", `Theme is ${current?.label || theme}.`);
          return;
        }
        const match = themes.find((item) => item.id === rest.toLowerCase() || item.label.toLowerCase() === rest.toLowerCase());
        if (!match) {
          push("err", "No theme by that name. Type themes.");
          return;
        }
        setTheme(match.id);
        push("out", `Theme is ${match.label}.`);
        return;
      }
      if (name === "open") {
        const screen = rest.toLowerCase() === "home" ? "overview" : rest.toLowerCase();
        if (!screens.includes(screen as (typeof screens)[number])) {
          push("err", "No screen by that name. Type help.");
          return;
        }
        onNavigate(screen);
        push("out", `Opened ${screen}.`);
        return;
      }
      if (name === "layout" && rest === "reset") {
        resetLayout();
        push("out", "Home cards are back to the original order.");
        return;
      }
      if (name === "layout") {
        const text = readLayout()
          .map((item) => {
            const card = portletCatalog.find((entry) => entry.id === item.id);
            const hidden = item.hidden ? "  hidden" : "";
            return `${(card?.label || item.id).padEnd(28)} ${widthWord(item.span)}${hidden}`;
          })
          .join("\n");
        push("out", text);
        return;
      }
      if (name === "who") {
        const response = await fetch("/api/me");
        const me = await response.json();
        if (!response.ok) throw new Error(me.error || "Could not read the signed-in user.");
        const lines = [me.name, me.email, me.accountId ? `Account ${me.accountId}` : "", me.roleId ? `Role ${me.roleId}` : ""].filter(Boolean);
        push("out", lines.join("\n") || "Signed in");
        return;
      }
      if (name === "sql") {
        if (!rest) {
          push("err", "Add a SELECT after sql.");
          return;
        }
        setBusy(true);
        const result = await postJson<{ columns: string[]; rows: Record<string, unknown>[]; hasMore: boolean }>(
          "/api/query",
          { sql: rest },
        );
        if (!result.rows.length) {
          push("out", "The query returned no rows.");
          return;
        }
        const extra = result.hasMore ? "\nShowing the first 40 rows. More are available." : "";
        push("out", `${asTable(result.columns, result.rows)}${extra}`);
        return;
      }
      if (name === "ask") {
        if (!rest) {
          push("err", "Add a question after ask.");
          return;
        }
        setBusy(true);
        const result = await postJson<{
          answer: string;
          steps: { name: string; ok: boolean; error?: string }[];
          pending: { name: string }[] | null;
        }>("/api/ask", { text: rest, transcript: [] });
        const parts = [];
        if (result.answer) parts.push(result.answer);
        for (const step of result.steps || []) {
          parts.push(`${step.ok ? "Ran" : "Failed"} ${step.name}${step.error ? `: ${step.error}` : ""}`);
        }
        if (result.pending?.length) parts.push("Nothing was posted. Confirm the change from Ask.");
        push("out", parts.join("\n") || "No answer came back.");
        return;
      }
      push("err", "No command by that name. Type help.");
    } catch (reason) {
      push("err", reason instanceof Error ? reason.message : "The command failed.");
    } finally {
      setBusy(false);
    }
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!history.current.length) return;
      if (cursor.current === history.current.length) draft.current = input;
      const next = Math.max(0, cursor.current - 1);
      cursor.current = next;
      setInput(history.current[next] || "");
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      if (cursor.current >= history.current.length) return;
      const next = cursor.current + 1;
      cursor.current = next;
      setInput(next >= history.current.length ? draft.current : history.current[next]);
    }
  }

  const shown = open ? (minimized ? 40 : height) : 0;

  return (
    <section className={dragging ? "cli dragging" : "cli"} style={{ height: shown }} aria-hidden={!open} inert={!open} aria-label="Command line">
      {open && !minimized && <div className="cli-grip" onPointerDown={startResize} role="separator" aria-orientation="horizontal" aria-label="Resize command line" />}
      <header className="drawer-bar">
        <strong>Command line</strong>
        <span className="status">{busy ? "Running" : "headless-ns"}</span>
        <div className="portlet-tools">
          <button className="quiet" type="button" onClick={() => setMinimized((value) => !value)}>
            {minimized ? "Restore" : "Minimize"}
          </button>
          <button className="quiet" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </header>
      {!minimized && (
        <>
          <div className="cli-log" ref={logRef}>
            {lines.map((line) => (
              <pre key={line.id} className={line.tone === "err" ? "cli-err" : line.tone === "in" ? "cli-in" : "cli-out"}>
                {line.tone === "in" ? `hn> ${line.text}` : line.text}
              </pre>
            ))}
          </div>
          <form
            className="cli-line"
            onSubmit={(event) => {
              event.preventDefault();
              run(input);
            }}
          >
            <span>hn&gt;</span>
            <input
              ref={inputRef}
              value={input}
              aria-label="Command"
              spellCheck={false}
              autoCapitalize="off"
              disabled={!open || busy}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={onKey}
            />
          </form>
        </>
      )}
    </section>
  );
}
