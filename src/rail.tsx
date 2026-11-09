import { useState, type ReactNode } from "react";
import { Glyph, glyph } from "./icons";
import { SkeletonTable } from "./load";

export type RailItem = { key: string; title: string; note?: string };

// The filterable list on the left of Records, Query, Searches and Workbench.
// It draws at most `limit` rows, so a 1,705-table list stays quick; the filter reaches the rest.
export function FilterRail({
  label,
  placeholder,
  items,
  selected,
  onPick,
  loading = false,
  empty = "Nothing to show.",
  limit = 100,
  children,
}: {
  label: string;
  placeholder: string;
  items: RailItem[];
  selected?: string;
  onPick: (key: string) => void;
  loading?: boolean;
  empty?: string;
  limit?: number;
  children?: ReactNode;
}) {
  const [text, setText] = useState("");
  const needle = text.trim().toLowerCase();
  const matches = needle ? items.filter((item) => `${item.title} ${item.note || ""} ${item.key}`.toLowerCase().includes(needle)) : items;
  const shown = matches.slice(0, limit);

  return (
    <div className="split-rail">
      <label className="search-field">
        <Glyph icon={glyph.search} size={14} />
        <input className="search" value={text} placeholder={placeholder} aria-label={label} onChange={(event) => setText(event.target.value)} />
      </label>
      {children}
      <div className="tool-list">
        {loading ? (
          <SkeletonTable rows={12} cols={1} />
        ) : (
          <>
            {shown.map((item) => (
              <button key={item.key} type="button" className={selected === item.key ? "tool on" : "tool"} onClick={() => onPick(item.key)}>
                <span>{item.title}</span>
                {item.note ? <em>{item.note}</em> : null}
              </button>
            ))}
            {items.length === 0 && <p className="rail-note">{empty}</p>}
            {items.length > 0 && matches.length === 0 && <p className="rail-note">Nothing matches that filter.</p>}
            {matches.length > shown.length && (
              <p className="rail-note">
                Showing {shown.length} of {matches.length.toLocaleString()}. Type to narrow the list.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
