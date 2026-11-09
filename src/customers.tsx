import { useEffect, useState } from "react";
import { amount, dateLabel, orBlank } from "./format";
import { DataTable, type Column } from "./table";
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
      <DataTable
        label="Customers"
        rows={live.data?.rows}
        rowKey={(row) => row.id}
        empty="No customers matched."
        columns={[
          {
            key: "name",
            label: "Name",
            cell: (row) => (
              <button className="linkish" type="button" onClick={() => setSelected(row.id)}>
                {row.name}
              </button>
            ),
          },
          { key: "company", label: "Company", cell: (row) => orBlank(row.company) },
          { key: "subsidiary", label: "Subsidiary", cell: (row) => orBlank(row.subsidiary) },
          { key: "email", label: "Email", cell: (row) => orBlank(row.email) },
          { key: "phone", label: "Phone", cell: (row) => orBlank(row.phone) },
          {
            key: "netsuite",
            label: "NetSuite",
            cell: (row) => <RecordActions kind="customer" id={row.id} title={row.name} href={row.href} recordType="customer" />,
          },
        ]}
      />
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
                  <strong>{orBlank(customer.company)}</strong>
                </div>
                <div>
                  <span>Subsidiary</span>
                  <strong>{orBlank(customer.subsidiary)}</strong>
                </div>
                <div>
                  <span>Email</span>
                  <strong>{orBlank(customer.email)}</strong>
                </div>
                <div>
                  <span>Phone</span>
                  <strong>{orBlank(customer.phone)}</strong>
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
              empty="No open orders."
              rows={file.data?.orders ?? []}
              columns={[
                { key: "number", label: "Number", cell: (row) => row.number },
                { key: "date", label: "Date", cell: (row) => dateLabel(row.date) },
                { key: "status", label: "Status", cell: (row) => <StatusPill value={row.status} /> },
                { key: "amount", label: "Amount", num: true, cell: (row) => amount(row.amount, row.currency) },
                {
                  key: "actions",
                  label: "",
                  cell: (row) => <RecordActions kind="transaction" id={row.id} title={row.number} href={row.href} recordType="salesorder" />,
                },
              ]}
            />
            <RelatedList
              id="related-invoices"
              title="Open invoices"
              count={file.data?.invoices.length ?? 0}
              empty="No open invoices."
              rows={file.data?.invoices ?? []}
              columns={[
                { key: "number", label: "Number", cell: (row) => row.number },
                { key: "due", label: "Due", cell: (row) => dateLabel(row.due) },
                { key: "open", label: "Open", num: true, cell: (row) => amount(row.unpaid, row.currency) },
                {
                  key: "actions",
                  label: "",
                  cell: (row) => <RecordActions kind="transaction" id={row.id} title={row.number} href={row.href} recordType="invoice" />,
                },
              ]}
            />
          </div>
        )}
      </aside>
    </div>
  );
}

export function RelatedList<T extends { id: string }>({
  id,
  title,
  count: total,
  columns,
  rows,
  empty,
}: {
  id: string;
  title: string;
  count: number;
  columns: Column<T>[];
  rows: T[];
  empty: string;
}) {
  return (
    <section className="related" id={id}>
      <header>
        {title}
        <span>{total}</span>
      </header>
      <DataTable label={title} columns={columns} rows={rows} rowKey={(row) => row.id} empty={empty} />
    </section>
  );
}
