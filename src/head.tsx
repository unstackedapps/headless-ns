import type { ReactNode } from "react";
import { kickerOf } from "./menu";
import { currentView } from "./nav";

// Every page title. The kicker is the page's menu group unless a page names its own.
export function PageHead({ title, kicker, children }: { title: ReactNode; kicker?: string; children?: ReactNode }) {
  const label = kicker ?? kickerOf(currentView());
  return (
    <header className="page-head">
      <div>
        {label && <div className="kicker">{label}</div>}
        <h1>{title}</h1>
      </div>
      {children}
    </header>
  );
}
