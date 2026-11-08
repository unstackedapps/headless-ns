import { useState } from "react";
import { amount, dateLabel } from "./format";
import { Pick } from "./pick";
import { flowLink, FLOW_LABELS, newLink } from "./transaction";
import { ListFrame, type ListPayload, Pager, RecordActions, StatusPill, listStatus, useDebounced, useLive } from "./lists";

type Row = {
  id: string;
  number: string;
  date: string;
  due: string;
  name: string;
  status: string;
  currency: string;
  amount: number | null;
  unpaid: number | null;
  href: string;
};
type Payload = ListPayload<Row> & { statuses: { id: string; label: string }[]; hasOpen: boolean };

// Every transaction list: /api/tx?list=orders&status=open&q=&page=0.
export function TransactionList({
  list,
  title,
  recordType,
  party,
  money = false,
  canCreate = false,
}: {
  list: string;
  title: string;
  recordType: string;
  party: "Customer" | "Vendor";
  money?: boolean;
  canCreate?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("open");
  const [page, setPage] = useState(0);
  const q = useDebounced(search, 300);
  const params = new URLSearchParams({ list, status, page: String(page) });
  if (q) params.set("q", q);
  const path = `/api/tx?${params}`;
  const live = useLive<Payload>(path);
  const statuses = live.data?.statuses || [];
  const hasStatus = statuses.length > 0;
  const hasOpen = live.data?.hasOpen ?? true;
  // Lists without an open set (payments) treat "open" as all.
  const shown = !hasOpen && status === "open" ? "all" : status;
  const columns = 5 + (money ? 2 : 0) + (hasStatus ? 1 : 0);
  const label = FLOW_LABELS[recordType] || title;
  return (
    <ListFrame
      title={title}
      viewName={hasStatus ? (shown === "open" ? `Open ${title.toLowerCase()}` : shown === "all" ? `All ${title.toLowerCase()}` : title) : `All ${title.toLowerCase()}`}
      status={listStatus(live)}
      error={live.error}
      loading={live.loading}
      ready={Boolean(live.data)}
      search={search}
      onSearch={(value) => {
        setSearch(value);
        setPage(0);
      }}
      placeholder={`Number or ${party.toLowerCase()}`}
      scope={path}
      tools={
        canCreate ? (
          <a className="primary" href={newLink(recordType)}>
            New {label.toLowerCase()}
          </a>
        ) : undefined
      }
      bar={
        hasStatus ? (
          <label className="list-filter">
            Status
            <Pick
              label="Status"
              value={shown}
              onChange={(value) => {
                setStatus(value);
                setPage(0);
              }}
              options={[
                ...(hasOpen ? [{ value: "open", label: "Open" }] : []),
                { value: "all", label: "All" },
                ...statuses.map((item) => ({ value: item.id, label: item.label })),
              ]}
            />
          </label>
        ) : undefined
      }
    >
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Number</th>
              <th>Date</th>
              {money && <th>Due</th>}
              <th>{party}</th>
              {hasStatus && <th>Status</th>}
              <th className="num">Amount</th>
              {money && <th className="num">Open</th>}
              <th>NetSuite</th>
            </tr>
          </thead>
          <tbody>
            {live.data?.rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <a href={flowLink(recordType, row.id)}>{row.number || row.id}</a>
                </td>
                <td>{dateLabel(row.date)}</td>
                {money && <td>{dateLabel(row.due)}</td>}
                <td>{row.name || "—"}</td>
                {hasStatus && (
                  <td>
                    <StatusPill value={row.status} />
                  </td>
                )}
                <td className="num">{amount(row.amount, row.currency)}</td>
                {money && <td className="num">{amount(row.unpaid, row.currency)}</td>}
                <td>
                  <RecordActions kind="transaction" id={row.id} title={row.number} href={row.href} recordType={recordType} />
                </td>
              </tr>
            ))}
            {live.data && live.data.rows.length === 0 && (
              <tr>
                <td className="empty" colSpan={columns}>
                  No {title.toLowerCase()} matched.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {live.data && <Pager page={page} hasMore={live.data.hasMore} onPage={setPage} />}
    </ListFrame>
  );
}
