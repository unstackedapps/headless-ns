import { useEffect, useState, type ReactNode } from "react";
import { amount, dateLabel } from "./format";
import { RelatedLink } from "./related";
import { Glyph, glyph } from "./icons";
import { Lookup, SkeletonRecord } from "./load";
import { RefreshButton } from "./refresh";
import { ListFrame, type ListPayload, RecordActions, StatusPill, explain, listStatus, useDebounced, useLive } from "./lists";

type Customer = {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  subsidiary: string;
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

export function CustomersPage() {
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
                  <RecordActions kind="customer" id={row.id} title={row.name} href={row.href} recordType="customer" />
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
                    <RecordActions kind="transaction" id={row.id} title={row.number} href={row.href} recordType="salesorder" />
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
                    <RecordActions kind="transaction" id={row.id} title={row.number} href={row.href} recordType="invoice" />
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
