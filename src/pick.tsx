import * as Popover from "@radix-ui/react-popover";
import * as Select from "@radix-ui/react-select";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { Spinner } from "./load";

export type PickItem = { value: string; label: string; group?: string };
export type Option = { id: string; label: string };

// The one searchable picker. The chosen value shows in the input; typing searches; picking replaces it.
export function Combobox({
  label,
  value,
  placeholder = "Search",
  search,
  onChange,
  disabled = false,
}: {
  label: string;
  value: Option | null;
  placeholder?: string;
  search: (text: string, signal: AbortSignal) => Promise<Option[]>;
  onChange: (option: Option) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Option[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      search(text ?? "", controller.signal)
        .then((found) => {
          setOptions(found);
          setActive(0);
          setError("");
        })
        .catch((reason: Error) => {
          if (reason.name !== "AbortError") setError(reason.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // search is recreated by callers each render; the text and open state decide when to look up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, open]);

  function choose(option: Option) {
    onChange(option);
    setText(null);
    setOpen(false);
  }

  return (
    <Popover.Root open={open && (loading || options.length > 0 || Boolean(error) || text !== null)} onOpenChange={(next) => !next && setOpen(false)}>
      <Popover.Anchor className="combo">
        <input
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          disabled={disabled}
          value={text ?? value?.label ?? ""}
          placeholder={placeholder}
          onFocus={(event) => {
            event.target.select();
            setOpen(true);
          }}
          onBlur={() => {
            setOpen(false);
            setText(null);
          }}
          onChange={(event) => {
            setText(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              setActive((at) => Math.min(at + 1, options.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((at) => Math.max(at - 1, 0));
            } else if (event.key === "Enter" && open && options[active]) {
              event.preventDefault();
              choose(options[active]);
            } else if (event.key === "Escape") {
              setOpen(false);
              setText(null);
            }
          }}
        />
        <span className="combo-icon">{loading ? <Spinner /> : <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" />}</span>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          className="pick-menu combo-menu"
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <ul id={listId} role="listbox" className="pick-view">
            {error && <li className="error">{error}</li>}
            {!error && !loading && options.length === 0 && <li className="combo-empty">Nothing matched.</li>}
            {!error && loading && options.length === 0 && <li className="combo-empty">Searching NetSuite.</li>}
            {options.map((option, index) => (
              <li
                key={option.id}
                role="option"
                aria-selected={index === active}
                className="pick-item"
                data-highlighted={index === active ? "" : undefined}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(option)}
              >
                {option.label}
              </li>
            ))}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function TipProvider({ children }: { children: ReactNode }) {
  return <Tooltip.Provider delayDuration={400}>{children}</Tooltip.Provider>;
}

export function Tip({
  label,
  side = "top",
  children,
}: {
  label: string;
  side?: "top" | "right" | "bottom" | "left";
  children: ReactNode;
}) {
  if (!label) return children;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tip" side={side} sideOffset={8}>
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function Pick({
  label,
  value,
  onChange,
  options,
  disabled = false,
  placeholder = "Choose",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: PickItem[];
  disabled?: boolean;
  placeholder?: string;
}) {
  const groups: { name: string; items: PickItem[] }[] = [];
  for (const option of options) {
    const name = option.group || "";
    let group = groups.find((item) => item.name === name);
    if (!group) {
      group = { name, items: [] };
      groups.push(group);
    }
    group.items.push(option);
  }

  return (
    <Select.Root value={value || undefined} onValueChange={onChange} disabled={disabled}>
      <Select.Trigger className="pick" aria-label={label}>
        <span className="pick-face">
          <Select.Value placeholder={placeholder} />
          <Select.Icon className="pick-icon">
            <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" />
          </Select.Icon>
        </span>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="pick-menu" position="popper" sideOffset={4} align="start">
          <Select.Viewport className="pick-view">
            {groups.map((group) => (
              <Select.Group key={group.name || "items"}>
                {group.name ? <Select.Label className="pick-label">{group.name}</Select.Label> : null}
                {group.items.map((option) => (
                  <Select.Item key={option.value} className="pick-item" value={option.value}>
                    <Select.ItemIndicator className="pick-check">
                      <Check size={14} strokeWidth={1.75} aria-hidden="true" />
                    </Select.ItemIndicator>
                    <Select.ItemText>{option.label}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.Group>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const weekdays = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function parseIso(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function toIso(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function showDate(value: string) {
  const date = parseIso(value);
  if (!date) return "Choose a date";
  return `${months[date.getMonth()].slice(0, 3)} ${date.getDate()}, ${date.getFullYear()}`;
}

export function DatePick({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const selected = parseIso(value);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(() => selected || new Date());
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1).getDay();
  const count = new Date(year, month + 1, 0).getDate();
  const cells: Array<number | null> = [...Array(first).fill(null), ...Array.from({ length: count }, (_, index) => index + 1)];

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setCursor(parseIso(value) || new Date());
      }}
    >
      <Popover.Trigger className="pick" aria-label={label}>
        <span className="pick-face">
          <span>{showDate(value)}</span>
          <ChevronDown className="pick-icon" size={14} strokeWidth={1.75} aria-hidden="true" />
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="date-menu" sideOffset={4} align="start">
          <div className="date-head">
            <button className="quiet" type="button" aria-label="Previous month" onClick={() => setCursor(new Date(year, month - 1, 1))}>
              <ChevronLeft size={14} strokeWidth={1.75} aria-hidden="true" />
            </button>
            <strong>
              {months[month]} {year}
            </strong>
            <button className="quiet" type="button" aria-label="Next month" onClick={() => setCursor(new Date(year, month + 1, 1))}>
              <ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
          <div className="date-grid">
            {weekdays.map((day) => (
              <span key={day}>{day}</span>
            ))}
            {cells.map((day, index) =>
              day == null ? (
                <span key={`pad-${index}`} />
              ) : (
                <button
                  key={day}
                  className={selected && selected.getFullYear() === year && selected.getMonth() === month && selected.getDate() === day ? "day on" : "day"}
                  type="button"
                  onClick={() => {
                    onChange(toIso(new Date(year, month, day)));
                    setOpen(false);
                  }}
                >
                  {day}
                </button>
              ),
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
