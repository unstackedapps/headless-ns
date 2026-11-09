import { useState } from "react";
import { BLANK, count, orBlank } from "./format";
import { DataTable } from "./table";
import { Pick } from "./pick";
import { ListFrame, type ListPayload, Pager, RecordActions, explain, listStatus, useDebounced, useLive } from "./lists";

type Item = {
  id: string;
  name: string;
  displayName: string;
  type: string;
  recordType: string;
  onHand: number | null;
  available: number | null;
  href: string;
};
type Payload = ListPayload<Item> & { types: { id: string; label: string }[] };

export function ItemsPage() {
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const [page, setPage] = useState(0);
  const q = useDebounced(search, 300);
  const params = new URLSearchParams({ type, page: String(page) });
  if (q) params.set("q", q);
  const path = `/api/items?${params}`;
  const live = useLive<Payload>(path);
  return (
    <ListFrame
      title="Items"
      viewName={type === "all" ? "All active items" : "Active items"}
      status={listStatus(live)}
      error={live.error}
      loading={live.loading}
      ready={Boolean(live.data)}
      search={search}
      onSearch={(value) => {
        setSearch(value);
        setPage(0);
      }}
      placeholder="Item name"
      scope={path}
      bar={
        <label className="list-filter">
          Type
          <Pick
            label="Item type"
            value={type}
            onChange={(value) => {
              setType(value);
              setPage(0);
            }}
            options={[{ value: "all", label: "All" }, ...(live.data?.types || []).map((item) => ({ value: item.id, label: item.label }))]}
          />
        </label>
      }
    >
      {live.data?.note && <p className="status">{explain(live.data.note)}</p>}
      <DataTable
        label="Items"
        rows={live.data?.rows}
        rowKey={(row) => row.id}
        empty="No items matched."
        columns={[
          { key: "name", label: "Name", cell: (row) => row.name },
          { key: "display", label: "Display name", cell: (row) => orBlank(row.displayName) },
          { key: "type", label: "Type", cell: (row) => orBlank(row.type) },
          { key: "onhand", label: "On hand", num: true, cell: (row) => (row.onHand == null ? BLANK : count(row.onHand)) },
          { key: "available", label: "Available", num: true, cell: (row) => (row.available == null ? BLANK : count(row.available)) },
          {
            key: "netsuite",
            label: "NetSuite",
            cell: (row) => <RecordActions kind="item" id={row.id} title={row.name} href={row.href} recordType={row.recordType || undefined} />,
          },
        ]}
      />
      {live.data && <Pager page={page} hasMore={live.data.hasMore} onPage={setPage} />}
    </ListFrame>
  );
}
