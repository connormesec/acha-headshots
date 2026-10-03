import type { ReactNode } from "react";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="app">
      <header className="masthead">
        <div className="masthead__inner">
          <span className="brand">
            <span className="brand__mark" aria-hidden="true" />
            <span className="brand__name">Puck Press</span>
            <span className="brand__product">ACHA Headshots</span>
          </span>
        </div>
        {/* blue line - red center line - blue line */}
        <div className="rinklines" aria-hidden="true"><span /><span /><span /></div>
      </header>
      <main className="page">{children}</main>
    </div>
  );
}
