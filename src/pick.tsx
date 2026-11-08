import * as Popover from "@radix-ui/react-popover";
import * as Select from "@radix-ui/react-select";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";

export type PickItem = { value: string; label: string; group?: string };

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
        <Select.Value placeholder={placeholder} />
        <Select.Icon className="pick-icon">
          <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" />
        </Select.Icon>
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
        <span>{showDate(value)}</span>
        <ChevronDown className="pick-icon" size={14} strokeWidth={1.75} aria-hidden="true" />
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
