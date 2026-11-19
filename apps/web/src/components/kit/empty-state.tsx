import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function EmptyState({
  title,
  children,
  className,
}: {
  title: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-1 rounded-xl border border-dashed border-line-3 px-4 py-5 text-[13px]",
        className,
      )}
    >
      <span className="font-medium text-fg-2">{title}</span>
      {children ? <span className="text-fg-3">{children}</span> : null}
    </div>
  );
}
