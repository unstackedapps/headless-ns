import { useState } from "react";
import { amount, dateLabel } from "./format";
import { ListFrame, type ListPayload, RecordActions, StatusPill, listStatus, useDebounced, useLive } from "./lists";

type Order = {
  id: string;
  number: string;
  date: string;
  customer: string;
  status: string;
  currency: string;
  amount: number | null;
  href: string;
};

export function TransactionList({
  title,
  path,
  placeholder,
  empty,
  recordType,
}: {
  title: string;
  path: string;
  placeholder: string;
  empty: string;
  recordType: string;
}) {
  const [search, setSearch] = useState("");
  const q = useDebounced(search, 300);
  const live = useLive<ListPayload<Order>>(`${path}${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  return (
    <ListFrame title={title} viewName={`Open ${title.toLowerCase()}`} status={listStatus(live)} error={live.error} loading={live.loading} ready={Boolean(live.data)} search={search} onSearch={setSearch} placeholder={placeholder} scope={q ? `${path}?q=${encodeURIComponent(q)}` : path}>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Number</th>
              <th>Date</th>
              <th>Customer</th>
              <th>Status</th>
              <th className="num">Amount</th>
              <th>NetSuite</th>
            </tr>
          </thead>
          <tbody>
            {live.data?.rows.map((row) => (
              <tr key={row.id}>
                <td>{row.number}</td>
                <td>{dateLabel(row.date)}</td>
                <td>{row.customer}</td>
                <td>
                  <StatusPill value={row.status} />
                </td>
                <td className="num">{amount(row.amount, row.currency)}</td>
                <td>
                  <RecordActions kind="transaction" id={row.id} title={row.number} href={row.href} recordType={recordType} />
                </td>
              </tr>
            ))}
            {live.data && live.data.rows.length === 0 && (
              <tr>
                <td className="empty" colSpan={6}>
                  {empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </ListFrame>
  );
}
