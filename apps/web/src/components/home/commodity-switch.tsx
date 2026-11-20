"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

type Option = { code: string; label: string };

function remember(code: string | null) {
  document.cookie = `home_commodity=${code ?? ""}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

/** Pills that scope the dashboard. The choice lives in ?c= and a cookie, so it survives reloads. */
export function CommoditySwitch({ options, active }: { options: readonly Option[]; active: string | null }) {
  const pills: { code: string | null; label: string }[] = [{ code: null, label: "All" }, ...options];
  return (
    <nav aria-label="Commodity" className="flex flex-wrap gap-2">
      {pills.map((o) => {
        const on = o.code === active;
        return (
          <Link
            key={o.label}
            href={o.code ? `/?c=${o.code}` : "/?c=all"}
            onClick={() => remember(o.code)}
            aria-current={on ? "page" : undefined}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-[13px] transition-colors",
              on
                ? "border-copper bg-copper/15 text-copper-2"
                : "border-line-3 text-fg-2 hover:border-copper hover:text-copper-2",
            )}
          >
            {o.label}
          </Link>
        );
      })}
    </nav>
  );
}
