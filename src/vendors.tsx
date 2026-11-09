import { useEffect, useState } from "react";
import { RelatedList } from "./customers";
import { amount, dateLabel, orBlank } from "./format";
import { DataTable } from "./table";
import { Glyph, glyph } from "./icons";
import { ListFrame, type ListPayload, Pager, RecordActions, StatusPill, explain, listStatus, useDebounced, useLive } from "./lists";
import { Lookup, SkeletonRecord } from "./load";
import { RefreshButton } from "./refresh";
import { flowLink, newLink } from "./transaction";

type Vendor = { id: string; name: string; company: string; email: string; phone: string; subsidiary: string; href: string };
type VendorTx = { id: string; number: string; date: string; due: string; status: string; currency: string; amount: number | null; unpaid: number | null };
type VendorFile = { vendor: Vendor; balance: { currency: string; amount: number | null }[]; orders: VendorTx[]; bills: VendorTx[] };

export function VendorsPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const q = useDebounced(search, 300);
  const path = `/api/vendors?page=${page}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  const live = useLive<ListPayload<Vendor>>(path);
  const file = useLive<VendorFile>(selected ? `/api/vendors/${selected}` : null);
  return (
    <ListFrame
      title="Vendors"
      viewName="Active vendors"
      status={listStatus(live)}
      error={live.error}
      loading={live.loading}
      ready={Boolean(live.data)}
      search={search}
      onSearch={(value) => {
        setSearch(value);
        setPage(0);
      }}
      placeholder="Name or email"
      scope={path}
    >
      <DataTable
        label="Vendors"
        rows={live.data?.rows}
        rowKey={(row) => row.id}
        empty="No vendors matched."
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
          { key: "netsuite", label: "NetSuite", cell: (row) => <RecordActions kind="vendor" id={row.id} title={row.name} href={row.href} recordType="vendor" /> },
        ]}
      />
      {live.data && <Pager page={page} hasMore={live.data.hasMore} onPage={setPage} />}
      {selected && <VendorPanel file={file} scope={`/api/vendors/${selected}`} onClose={() => setSelected(null)} />}
    </ListFrame>
  );
}

function VendorPanel({
  file,
  scope,
  onClose,
}: {
  file: { data: VendorFile | null; error: string | null; loading: boolean };
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
  const vendor = file.data?.vendor;
  return (
    <div className="backdrop" role="presentation" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-label={vendor?.name || "Vendor"} onClick={(event) => event.stopPropagation()}>
        <header className="record-top">
          <div className="drawer-top">
            <div>
              <div className="kicker">Vendor</div>
              <h2>{vendor?.name || "Vendor"}</h2>
            </div>
            <div className="actions">
              {vendor && (
                <>
                  <a className="quiet" href={newLink("purchaseorder")}>
                    New purchase order
                  </a>
                  <a className="quiet" href={vendor.href} target="_blank" rel="noreferrer">
                    <Glyph icon={glyph.external} size={14} />
                    Open in NetSuite
                  </a>
                </>
              )}
              <RefreshButton label="vendor" scope={scope} busy={file.loading && Boolean(vendor)} />
              <button className="quiet" type="button" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
          {file.loading && !vendor && (
            <>
              <Lookup label="Looking up this vendor." />
              <SkeletonRecord />
            </>
          )}
          {file.error && <p className="error">{explain(file.error)}</p>}
          {vendor && (
            <div className="highlights">
              <div>
                <span>Company</span>
                <strong>{orBlank(vendor.company)}</strong>
              </div>
              <div>
                <span>Subsidiary</span>
                <strong>{orBlank(vendor.subsidiary)}</strong>
              </div>
              <div>
                <span>Email</span>
                <strong>{orBlank(vendor.email)}</strong>
              </div>
              <div>
                <span>Phone</span>
                <strong>{orBlank(vendor.phone)}</strong>
              </div>
              <div>
                <span>Open bills</span>
                <strong>{file.data?.balance.length ? file.data.balance.map((row) => amount(row.amount, row.currency)).join(", ") : "0.00"}</strong>
              </div>
            </div>
          )}
        </header>
        {vendor && (
          <div className="record-body">
            <RelatedList
              id="vendor-orders"
              title="Open purchase orders"
              count={file.data?.orders.length ?? 0}
              empty="No open purchase orders."
              rows={file.data?.orders ?? []}
              columns={[
                { key: "number", label: "Number", cell: (row) => <a href={flowLink("purchaseorder", row.id)} onClick={onClose}>{row.number}</a> },
                { key: "date", label: "Date", cell: (row) => dateLabel(row.date) },
                { key: "status", label: "Status", cell: (row) => <StatusPill value={row.status} /> },
                { key: "amount", label: "Amount", num: true, cell: (row) => amount(row.amount, row.currency) },
              ]}
            />
            <RelatedList
              id="vendor-bills"
              title="Open bills"
              count={file.data?.bills.length ?? 0}
              empty="No open bills."
              rows={file.data?.bills ?? []}
              columns={[
                { key: "number", label: "Number", cell: (row) => <a href={flowLink("vendorbill", row.id)} onClick={onClose}>{row.number}</a> },
                { key: "due", label: "Due", cell: (row) => dateLabel(row.due) },
                { key: "status", label: "Status", cell: (row) => <StatusPill value={row.status} /> },
                { key: "open", label: "Open", num: true, cell: (row) => amount(row.unpaid, row.currency) },
              ]}
            />
          </div>
        )}
      </aside>
    </div>
  );
}
