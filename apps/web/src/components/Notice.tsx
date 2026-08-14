import type { ReactNode } from "react";

export function Notice({ tone = "info", children }: { tone?: "info" | "warning" | "danger" | "success"; children: ReactNode }) {
  return <div className={`notice notice-${tone}`}>{children}</div>;
}
