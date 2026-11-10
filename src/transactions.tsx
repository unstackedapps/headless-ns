import { useState } from "react";
import { amount, dateLabel, orBlank } from "./format";
import { DataTable } from "./table";
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
      <DataTable
        label={title}
        rows={live.data?.rows}
        rowKey={(row) => row.id}
        empty={`No ${title.toLowerCase()} matched.`}
        columns={[
          { key: "number", label: "Number", nowrap: true, cell: (row) => <a href={flowLink(recordType, row.id)}>{row.number || row.id}</a> },
          { key: "date", label: "Date", nowrap: true, cell: (row) => dateLabel(row.date) },
          ...(money ? [{ key: "due", label: "Due", nowrap: true, cell: (row: Row) => dateLabel(row.due) }] : []),
          { key: "party", label: party, value: (row) => row.name, cell: (row) => orBlank(row.name) },
          ...(hasStatus ? [{ key: "status", label: "Status", cell: (row: Row) => <StatusPill value={row.status} /> }] : []),
          { key: "amount", label: "Amount", num: true, cell: (row) => amount(row.amount, row.currency) },
          ...(money ? [{ key: "open", label: "Open", num: true, value: (row: Row) => row.unpaid, cell: (row: Row) => amount(row.unpaid, row.currency) }] : []),
          {
            key: "netsuite",
            label: "NetSuite",
            cell: (row) => <RecordActions kind="transaction" id={row.id} title={row.number} href={row.href} recordType={recordType} />,
          },
        ]}
      />
      {live.data && <Pager page={page} hasMore={live.data.hasMore} onPage={setPage} />}
    </ListFrame>
  );
}
