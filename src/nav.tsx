import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import { isViewId, moveMenu, readMenu, setHidden, type MenuItem, type PageId } from "./menu";
import { Glyph, glyph, navIcons } from "./icons";
import { Tip } from "./pick";

export function hashName() {
  return location.hash.replace(/^#\/?/, "").split("?")[0];
}

export function currentView(): PageId {
  const name = hashName();
  if (name === "transaction") return name;
  if (name === "ask") return "overview";
  return isViewId(name) ? name : "overview";
}

function useMenu() {
  const [items, setItems] = useState<MenuItem[]>(() => {
    try {
      return readMenu(JSON.parse(localStorage.getItem("hn-menu") || "null"));
    } catch {
      return readMenu(null);
    }
  });
  const [editing, setEditing] = useState(false);

  function update(next: MenuItem[]) {
    setItems(next);
    localStorage.setItem("hn-menu", JSON.stringify(next.map(({ id, hidden }) => ({ id, hidden }))));
  }

  return {
    items,
    editing,
    setEditing,
    move: (id: string, direction: -1 | 1) => update(moveMenu(items, id, direction)),
    hide: (id: string, hidden: boolean) => update(setHidden(items, id, hidden)),
  };
}

export function SideNav({ view }: { view: PageId }) {
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem("hn-nav-w"));
    return saved >= 168 && saved <= 480 ? saved : 212;
  });
  const [open, setOpen] = useState(() => localStorage.getItem("hn-nav-open") !== "0");
  const [dragging, setDragging] = useState(false);
  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 860px)").matches);
  const menu = useMenu();

  useEffect(() => {
    const query = window.matchMedia("(max-width: 860px)");
    const onChange = () => setNarrow(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  function toggle() {
    setOpen((value) => {
      localStorage.setItem("hn-nav-open", value ? "0" : "1");
      return !value;
    });
  }

  function resizeTo(next: number) {
    const clamped = Math.min(480, Math.max(168, next));
    setWidth(clamped);
    localStorage.setItem("hn-nav-w", String(clamped));
  }

  function startResize(event: ReactPointerEvent) {
    if (!open || narrow) return;
    const startX = event.clientX;
    const startW = width;
    setDragging(true);
    const move = (ev: PointerEvent) => resizeTo(startW + (ev.clientX - startX));
    const stop = () => {
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }

  return (
    <nav
      className={[open ? "" : "is-collapsed", dragging ? "is-dragging" : ""].filter(Boolean).join(" ")}
      style={!narrow && open ? { width } : undefined}
      aria-label="Sections"
    >
      <div className="nav-links">
        {menu.editing && open && <p className="status nav-note">Up and down move an item. Hide takes it off this menu.</p>}
        {["Ledger", "Studio"].map((group) => {
          const rows = menu.items.filter((item) => item.group === group && (menu.editing || !item.hidden));
          if (!rows.length) return null;
          return (
            <div key={group}>
              <span className="nav-label">{group}</span>
              {rows.map((item) =>
                menu.editing && open ? (
                  <div key={item.id} className={item.hidden ? "nav-row is-hidden" : "nav-row"}>
                    <button className="quiet nav-mini" type="button" aria-label={`Move ${item.label} up`} onClick={() => menu.move(item.id, -1)}>
                      <Glyph icon={glyph.up} size={14} />
                    </button>
                    <button className="quiet nav-mini" type="button" aria-label={`Move ${item.label} down`} onClick={() => menu.move(item.id, 1)}>
                      <Glyph icon={glyph.down} size={14} />
                    </button>
                    <a href={`#/${item.id}`} aria-current={view === item.id ? "page" : undefined}>
                      <Glyph icon={navIcons[item.id]} />
                      <span className="nav-text">{item.label}</span>
                    </a>
                    <button
                      className="quiet nav-mini"
                      type="button"
                      aria-label={item.hidden ? `Show ${item.label}` : `Hide ${item.label}`}
                      onClick={() => menu.hide(item.id, !item.hidden)}
                    >
                      <Glyph icon={item.hidden ? glyph.eye : glyph.eyeOff} size={14} />
                    </button>
                  </div>
                ) : (
                  <Tip key={item.id} label={open ? "" : item.label} side="right">
                    <a href={`#/${item.id}`} aria-current={view === item.id ? "page" : undefined} aria-label={item.label}>
                      <Glyph icon={navIcons[item.id]} />
                      <span className="nav-text">{item.label}</span>
                    </a>
                  </Tip>
                ),
              )}
            </div>
          );
        })}
      </div>
      <div className="nav-tools">
        {open && (
          <button className={menu.editing ? "quiet on nav-toggle" : "quiet nav-toggle"} type="button" aria-pressed={menu.editing} onClick={() => menu.setEditing((value) => !value)}>
            {menu.editing ? "Done" : "Arrange"}
          </button>
        )}
        <Tip label={open ? "" : "Show menu"} side="right">
        <button className="quiet nav-toggle" type="button" aria-pressed={open} aria-label={open ? "Hide menu" : "Show menu"} onClick={toggle}>
          <Glyph icon={open ? glyph.hide : glyph.show} />
          {open && <span className="nav-text">Hide</span>}
        </button>
        </Tip>
      </div>
      {open && !narrow && (
        <div
          className="nav-grip"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize menu"
          aria-valuemin={168}
          aria-valuemax={480}
          aria-valuenow={Math.round(width)}
          tabIndex={0}
          onPointerDown={startResize}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") resizeTo(width - 16);
            if (event.key === "ArrowRight") resizeTo(width + 16);
          }}
        />
      )}
    </nav>
  );
}
