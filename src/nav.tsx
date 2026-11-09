import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import { groupOf, isViewId, menuGroups, moveMenu, readGroups, readMenu, saveMenu, setHidden, type MenuItem, type PageId } from "./menu";
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
  const [groups, setGroups] = useState<Record<string, boolean>>(() => {
    try {
      return readGroups(JSON.parse(localStorage.getItem("hn-menu-groups") || "null"));
    } catch {
      return readGroups(null);
    }
  });

  function update(next: MenuItem[]) {
    setItems(next);
    localStorage.setItem("hn-menu", JSON.stringify(saveMenu(next)));
  }

  function setGroup(id: string, open: boolean) {
    if (groups[id] === open) return;
    const next = { ...groups, [id]: open };
    localStorage.setItem("hn-menu-groups", JSON.stringify(next));
    setGroups(next);
  }

  return {
    items,
    editing,
    setEditing,
    groups,
    setGroup,
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
  const flat = !open || narrow;

  // The group holding the current page opens, so the page's entry is always in view.
  const currentGroup = groupOf(view);
  useEffect(() => {
    if (currentGroup) menu.setGroup(currentGroup, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentGroup]);

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

  function rowsOf(group: string) {
    return menu.items.filter((item) => item.group === group && (menu.editing || !item.hidden));
  }

  function row(item: MenuItem) {
    if (menu.editing && open) {
      return (
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
      );
    }
    return (
      <Tip key={item.id} label={open ? "" : item.label} side="right">
        <a href={`#/${item.id}`} aria-current={view === item.id ? "page" : undefined} aria-label={item.label}>
          <Glyph icon={navIcons[item.id]} />
          <span className="nav-text">{item.label}</span>
        </a>
      </Tip>
    );
  }

  return (
    <nav
      className={[open ? "" : "is-collapsed", dragging ? "is-dragging" : ""].filter(Boolean).join(" ")}
      style={!narrow && open ? { width } : undefined}
      aria-label="Sections"
    >
      {rowsOf("Top").map(row)}
      <div className="nav-links">
        {menu.editing && open && <p className="status nav-note">Use the arrows to move an item, and the eye to hide it.</p>}
        {menuGroups.map(({ id: group }) => {
          const rows = rowsOf(group);
          if (!rows.length) return null;
          if (flat) {
            return (
              <div key={group} className="nav-group" role="group" aria-label={group}>
                {narrow && open && <span className="nav-label">{group}</span>}
                {rows.map(row)}
              </div>
            );
          }
          return (
            <details key={group} className="nav-group" open={menu.editing || menu.groups[group]}>
              <summary
                className="nav-label"
                onClick={(event) => {
                  // React owns the open state, so a reload shows what was last chosen.
                  event.preventDefault();
                  if (!menu.editing) menu.setGroup(group, !menu.groups[group]);
                }}
              >
                {group}
                <Glyph icon={glyph.chevron} size={14} />
              </summary>
              {rows.map(row)}
            </details>
          );
        })}
      </div>
      <div className="nav-bottom">
        {rowsOf("Bottom").map(row)}
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
