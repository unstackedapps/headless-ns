import { useEffect, useState } from "react";
import { Glyph, glyph } from "./icons";
import { Lookup } from "./load";
import { useDebounced } from "./lists";
import { DataTable } from "./table";
import { orBlank } from "./format";
import { api } from "./api";

// Plain names for the record types people open most. They lead the Records rail.
export const commonTypes: Record<string, string> = {
  customer: "Customer",
  vendor: "Vendor",
  employee: "Employee",
  contact: "Contact",
  inventoryitem: "Inventory item",
  estimate: "Quote",
  salesorder: "Sales order",
  itemfulfillment: "Fulfillment",
  invoice: "Invoice",
  customerpayment: "Payment",
  returnauthorization: "Return",
  purchaseorder: "Purchase order",
  itemreceipt: "Receipt",
  vendorbill: "Bill",
  vendorpayment: "Bill payment",
  journalentry: "Journal entry",
};

export function typeLabel(type: string) {
  return commonTypes[type] || type;
}

export type Recent = { type: string; id: string; label: string };

const RECENT_KEY = "hn-records-recent";

export function readRecent(): Recent[] {
  try {
    const saved = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(saved) ? saved.filter((row) => row && typeof row.type === "string" && typeof row.id === "string").slice(0, 20) : [];
  } catch {
    return [];
  }
}

// The last 20 records opened in this browser, newest first.
export function pushRecent(entry: Recent) {
  const next = [entry, ...readRecent().filter((row) => !(row.type === entry.type && row.id === entry.id))].slice(0, 20);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event("hn-recent"));
}

function useRecent() {
  const [recent, setRecent] = useState(readRecent);
  useEffect(() => {
    const update = () => setRecent(readRecent());
    window.addEventListener("hn-recent", update);
    return () => window.removeEventListener("hn-recent", update);
  }, []);
  return recent;
}

type Found = { id: string; type: string; label: string; detail: string };

// Finds a record by number, name or email, and lists the recent ones while the box is empty.
export function RecordFinder({ onOpen }: { onOpen: (type: string, id: string) => void }) {
  const [text, setText] = useState("");
  const q = useDebounced(text.trim(), 300);
  const [found, setFound] = useState<Found[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recent = useRecent();

  useEffect(() => {
    if (q.length < 2) {
      setFound(null);
      setError(null);
      return;
    }
    const controller = new AbortController();
    setFound(null);
    setError(null);
    api<{ rows: Found[] }>(`/api/records/find?q=${encodeURIComponent(q)}`, { signal: controller.signal })
      .then((body) => setFound(body.rows))
      .catch((reason: Error) => {
        if (reason.name !== "AbortError") setError(reason.message);
      });
    return () => controller.abort();
  }, [q]);

  return (
    <section className="finder">
      <label className="search-field">
        <Glyph icon={glyph.search} size={14} />
        <input
          className="search"
          type="search"
          value={text}
          placeholder="Find a record by number, name or email"
          aria-label="Find a record"
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      {q.length >= 2 ? (
        <>
          {!found && !error && <Lookup label="Searching transactions, customers, vendors, employees and items." />}
          <DataTable
            label="Search results"
            rows={found}
            error={error}
            rowKey={(row) => `${row.type}:${row.id}`}
            empty="No record matches that."
            columns={[
              {
                key: "label",
                label: "Record",
                cell: (row) => (
                  <button className="linkish" type="button" onClick={() => onOpen(row.type, row.id)}>
                    {row.label || row.id}
                  </button>
                ),
              },
              { key: "type", label: "Type", cell: (row) => typeLabel(row.type) },
              { key: "detail", label: "Detail", cell: (row) => orBlank(row.detail) },
            ]}
          />
        </>
      ) : (
        recent.length > 0 && (
          <nav className="quick" aria-label="Recent records">
            <span className="status">Recent</span>
            {recent.map((row) => (
              <button key={`${row.type}:${row.id}`} className="chip" type="button" onClick={() => onOpen(row.type, row.id)}>
                {typeLabel(row.type)} {row.label}
              </button>
            ))}
          </nav>
        )
      )}
    </section>
  );
}

type Latest = { id: string; label: string; detail: string };

// The newest 50 records of a type, to pick one instead of typing its internal ID.
export function LatestRecords({ type, onOpen }: { type: string; onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<Latest[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setRows(null);
    setError(null);
    api<{ rows: Latest[] }>(`/api/records/latest?type=${encodeURIComponent(type)}`, { signal: controller.signal })
      .then((body) => setRows(body.rows))
      .catch((reason: Error) => {
        if (reason.name !== "AbortError") setError(reason.message);
      });
    return () => controller.abort();
  }, [type]);

  return (
    <section className="section">
      <h2>Newest {typeLabel(type).toLowerCase()} records</h2>
      <DataTable
        label={`Newest ${typeLabel(type)} records`}
        rows={rows}
        loading
        skeletonRows={6}
        error={error}
        rowKey={(row) => row.id}
        empty="SuiteQL lists none of this type. Type an internal ID above."
        columns={[
          {
            key: "label",
            label: "Record",
            cell: (row) => (
              <button className="linkish" type="button" onClick={() => onOpen(row.id)}>
                {row.label || row.id}
              </button>
            ),
          },
          { key: "detail", label: "Detail", cell: (row) => orBlank(row.detail) },
          { key: "id", label: "Internal ID", num: true, cell: (row) => row.id },
        ]}
      />
    </section>
  );
}
