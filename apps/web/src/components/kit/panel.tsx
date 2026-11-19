import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The design's card: #12151A, 1px #222831, 14px radius, Space Grotesk 18px title. */
export function Panel({
  title,
  subtitle,
  action,
  children,
  className,
  flush = false,
  as: Tag = "section",
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  /** No horizontal padding on the body, for edge-to-edge tables. */
  flush?: boolean;
  as?: "section" | "div" | "aside";
}) {
  return (
    <Tag
      className={cn(
        "flex min-w-0 flex-col gap-4 rounded-2xl border border-line bg-panel py-5",
        !flush && "px-5",
        className,
      )}
    >
      {title || action ? (
        <div className={cn("flex flex-wrap items-center justify-between gap-3", flush && "px-5")}>
          <div className="min-w-0">
            {title ? <h2 className="font-heading text-lg font-semibold">{title}</h2> : null}
            {subtitle ? <p className="text-[13px] text-fg-3">{subtitle}</p> : null}
          </div>
          {action}
        </div>
      ) : null}
      {children}
    </Tag>
  );
}

export function PanelLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-[13px] text-copper transition-colors hover:text-copper-2">
      {children}
    </Link>
  );
}
