import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { TableSlot } from "./table";
import { Glyph, glyph } from "./icons";
import { Lookup, SkeletonRecord } from "./load";

// The one side drawer, on Radix Dialog: it traps focus, closes on Escape or a click outside,
// and locks the page scroll. `head` sits in the sticky header under the title; `loading`
// shows a lookup line and a record skeleton until the first answer.
export function Drawer({
  kicker,
  title,
  actions,
  head,
  loading,
  error,
  narrow = false,
  onClose,
  children,
}: {
  kicker: string;
  title: string;
  actions?: ReactNode;
  head?: ReactNode;
  loading?: string | false;
  error?: string | null;
  narrow?: boolean;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="backdrop" />
        <Dialog.Content className={narrow ? "drawer narrow" : "drawer"} aria-describedby={undefined}>
          <header className="record-top">
            <div className="drawer-top">
              <div>
                <div className="kicker">{kicker}</div>
                <Dialog.Title asChild>
                  <h2>{title}</h2>
                </Dialog.Title>
              </div>
              <div className="actions">
                {actions}
                <Dialog.Close asChild>
                  <button className="quiet" type="button">
                    <Glyph icon={glyph.close} size={14} />
                    Close
                  </button>
                </Dialog.Close>
              </div>
            </div>
            {loading && (
              <>
                <Lookup label={loading} />
                <SkeletonRecord />
              </>
            )}
            {error && <p className="error">{error}</p>}
            {head}
          </header>
          <TableSlot.Provider value={null}>{children}</TableSlot.Provider>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
