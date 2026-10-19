"use client";

import type { ReactNode, MouseEvent } from "react";
import { useRef } from "react";

export function ReportDetailsControls({ children }: { children: ReactNode }) {
  const container = useRef<HTMLDivElement>(null);

  const setAll = (event: MouseEvent<HTMLButtonElement>, open: boolean) => {
    event.preventDefault();
    container.current?.querySelectorAll("details").forEach((detail) => {
      detail.open = open;
    });
  };

  return (
    <div ref={container} className="report-details-controls space-y-2">
      <div className="flex justify-end gap-3 text-xs">
        <button type="button" onClick={(event) => setAll(event, true)} className="text-primary hover:underline">
          Expand all
        </button>
        <button type="button" onClick={(event) => setAll(event, false)} className="text-primary hover:underline">
          Collapse all
        </button>
      </div>
      {children}
    </div>
  );
}
