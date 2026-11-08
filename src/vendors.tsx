import { useEffect, useState } from "react";
import { RelatedList } from "./customers";
import { amount, dateLabel } from "./format";
import { Glyph, glyph } from "./icons";
import { recordLink } from "./records";
import { ListFrame, type ListPayload, Pager, StatusPill, explain, listStatus, useDebounced, useLive } from "./lists";
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
                  <div className="row-actions">
                    <a href={recordLink("vendor", row.id)} aria-label={`Open ${row.name} in Records`}>
                      Records
                    </a>
                    <a href={row.href} target="_blank" rel="noreferrer" aria-label={`Open ${row.name} in NetSuite`}>
                      <Glyph icon={glyph.external} size={14} />
                      Open
                    </a>
                  </div>
                </td>
              </tr>
            ))}
            {live.data && live.data.rows.length === 0 && (
              <tr>
                <td className="empty" colSpan={6}>
                  No vendors matched.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
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
                <strong>{vendor.company || "—"}</strong>
              </div>
              <div>
                <span>Subsidiary</span>
                <strong>{vendor.subsidiary || "—"}</strong>
              </div>
              <div>
                <span>Email</span>
                <strong>{vendor.email || "—"}</strong>
              </div>
              <div>
                <span>Phone</span>
                <strong>{vendor.phone || "—"}</strong>
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
              headers={["Number", "Date", "Status", "Amount"]}
              empty="No open purchase orders."
              rows={file.data?.orders ?? []}
              render={(row) => (
                <>
                  <td>
                    <a href={flowLink("purchaseorder", row.id)} onClick={onClose}>
                      {row.number}
                    </a>
                  </td>
                  <td>{dateLabel(row.date)}</td>
                  <td>
                    <StatusPill value={row.status} />
                  </td>
                  <td className="num">{amount(row.amount, row.currency)}</td>
                </>
              )}
            />
            <RelatedList
              id="vendor-bills"
              title="Open bills"
              count={file.data?.bills.length ?? 0}
              headers={["Number", "Due", "Status", "Open"]}
              empty="No open bills."
              rows={file.data?.bills ?? []}
              render={(row) => (
                <>
                  <td>
                    <a href={flowLink("vendorbill", row.id)} onClick={onClose}>
                      {row.number}
                    </a>
                  </td>
                  <td>{dateLabel(row.due)}</td>
                  <td>
                    <StatusPill value={row.status} />
                  </td>
                  <td className="num">{amount(row.unpaid, row.currency)}</td>
                </>
              )}
            />
          </div>
        )}
      </aside>
    </div>
  );
}
