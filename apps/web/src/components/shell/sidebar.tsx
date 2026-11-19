"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { UserButton } from "@clerk/nextjs";
import type { ChatSummary } from "@/lib/chat-types";
import { cn } from "@/lib/utils";

type NavItem = { key: string; label: string; href: string; d: string; badge?: number; admin?: boolean };

// Icon paths from docs/design/Sidebar.dc.html.
const GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Intelligence",
    items: [
      { key: "home", label: "Home", href: "/", d: "M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" },
      { key: "chat", label: "Chat", href: "/chat", d: "M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z" },
      { key: "screener", label: "Screener", href: "/screener", d: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M14 4v4M8 10v4M16 16v4" },
      { key: "watchlist", label: "Watchlist", href: "/watchlist", d: "M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z" },
      { key: "research", label: "Research", href: "/research", d: "M3 3v18h18M7 15l4-4 3 3 5-6" },
    ],
  },
  {
    label: "Corpus",
    items: [
      { key: "companies", label: "Companies", href: "/companies", d: "M4 21V5l8-2v18M12 9h8v12M3 21h18" },
      { key: "documents", label: "Documents", href: "/documents", d: "M14 3H6v18h12V7zM14 3v4h4M9 13h6M9 17h6" },
    ],
  },
  {
    label: "Operations",
    items: [
      { key: "admin", label: "Pipeline", href: "/admin", d: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z", admin: true },
      { key: "review", label: "Review queue", href: "/admin/review", d: "M4 4h16v16H4zM8 12l3 3 5-6", admin: true },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  // /admin must not light up on /admin/review.
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export type IngestionChip = { live: boolean; title: string; detail: string };

export function Sidebar({
  chats,
  showAdmin,
  badges,
  ingestion,
  hasClerk,
}: {
  chats: ChatSummary[];
  showAdmin: boolean;
  badges: { watchlist: number; review: number };
  ingestion: IngestionChip;
  hasClerk: boolean;
}) {
  const pathname = usePathname();
  // Open state is tied to the path it was opened on, so navigating closes it without an effect.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;

  const groups = GROUPS.map((g) => ({
    ...g,
    items: g.items
      .filter((i) => showAdmin || !i.admin)
      .map((i) => ({ ...i, badge: i.key === "watchlist" ? badges.watchlist : i.key === "review" ? badges.review : 0 })),
  })).filter((g) => g.items.length > 0);

  const brand = (
    <Link href="/" className="flex items-center gap-2.5 px-2 py-1 text-fg">
      <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
        <path d="M14 2 25 8.5v11L14 26 3 19.5v-11z" fill="none" stroke="#E0985A" strokeWidth="1.6" />
        <path d="M3 12.5 14 19l11-6.5M3 16 14 22.5 25 16" fill="none" stroke="#E0985A" strokeWidth="1.2" opacity="0.55" />
        <circle cx="14" cy="11" r="2.4" fill="#E0985A" />
      </svg>
      <span className="font-heading text-[19px] font-semibold tracking-[-0.01em]">OreBase</span>
    </Link>
  );

  return (
    <nav
      aria-label="Main"
      className="sticky top-0 z-40 flex flex-col border-b border-line-soft bg-nav md:h-dvh md:gap-[22px] md:overflow-y-auto md:border-b-0 md:px-3.5 md:py-5"
    >
      {/* Phone: compact bar with a disclosure. Desktop: always expanded. */}
      <div className="flex h-14 items-center justify-between px-3 md:h-auto md:px-0">
        {brand}
        <button
          type="button"
          className="grid size-10 place-items-center rounded-lg text-fg-3 hover:bg-raised hover:text-fg md:hidden"
          aria-expanded={open}
          aria-controls="main-nav-panel"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpenOn(open ? null : pathname)}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d={open ? "M6 6l12 12M18 6 6 18" : "M4 7h16M4 12h16M4 17h16"} />
          </svg>
        </button>
      </div>

      <div
        id="main-nav-panel"
        className={cn(
          "flex-col gap-[22px] px-3.5 pt-1 pb-5 md:flex md:flex-1 md:p-0",
          open ? "flex max-h-[calc(100dvh-3.5rem)] overflow-y-auto" : "hidden",
        )}
      >
        <Link
          href="/chat"
          className="flex h-10 items-center gap-2.5 rounded-[10px] border border-line-2 bg-field px-3 text-[13px] font-medium text-fg-3 transition-colors hover:border-line-3 hover:text-fg"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5" />
          </svg>
          <span className="flex-1">Search or ask…</span>
        </Link>

        {groups.map((group) => (
          <div key={group.label} className="flex flex-col gap-0.5">
            <div className="px-2.5 pb-1.5 text-[11px] font-semibold tracking-[0.08em] text-fg-4 uppercase">{group.label}</div>
            {group.items.map((item) => {
              const on = isActive(pathname, item.href);
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  aria-current={on ? "page" : undefined}
                  className={cn(
                    "flex h-[38px] items-center gap-[11px] rounded-lg px-2.5 text-sm font-medium transition-colors duration-(--duration-instant)",
                    on
                      ? "bg-copper-wash text-copper-2 shadow-[inset_2px_0_0_#E0985A]"
                      : "text-fg-3 hover:bg-raised hover:text-fg",
                  )}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d={item.d} />
                  </svg>
                  <span className="flex-1">{item.label}</span>
                  {item.badge ? (
                    <span className="num rounded-full bg-copper-tint px-[7px] py-px text-[11px] font-medium text-copper-2">
                      <span className="sr-only">, </span>
                      {item.badge}
                      <span className="sr-only">{item.key === "review" ? " to review" : " unread"}</span>
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ))}

        {chats.length > 0 ? (
          <div className="flex flex-col gap-0.5">
            <div className="px-2.5 pb-1.5 text-[11px] font-semibold tracking-[0.08em] text-fg-4 uppercase">Recent chats</div>
            {chats.slice(0, 5).map((chat) => {
              const href = `/chat/${chat.id}`;
              return (
                <Link
                  key={chat.id}
                  href={href}
                  aria-current={pathname === href ? "page" : undefined}
                  className={cn(
                    "block truncate rounded-lg px-2.5 py-[7px] text-[13px] transition-colors hover:bg-raised hover:text-fg",
                    pathname === href ? "text-fg" : "text-fg-3",
                  )}
                >
                  {chat.title ?? "Untitled chat"}
                </Link>
              );
            })}
          </div>
        ) : null}

        <div className="mt-auto flex flex-col gap-3">
          <Link
            href={showAdmin ? "/admin" : "/documents"}
            className="flex items-center gap-2.5 rounded-[10px] border border-[#1F2A25] bg-[#11161B] px-3 py-2.5 text-xs text-fg-2"
          >
            <span
              aria-hidden="true"
              className={cn("size-2 flex-none rounded-full", ingestion.live ? "live-pulse bg-ok" : "bg-fg-4")}
            />
            <span className="flex-1 leading-[1.35]">
              {ingestion.title}
              <br />
              <span className="text-fg-4">{ingestion.detail}</span>
            </span>
          </Link>
          <div className="flex min-h-9 items-center gap-2.5 px-2 py-1">
            {hasClerk ? (
              <UserButton showName appearance={{ elements: { avatarBox: "size-8" } }} />
            ) : (
              <>
                <span className="grid size-8 place-items-center rounded-full bg-copper-tint text-[13px] font-semibold text-copper-2">L</span>
                <span className="flex-1 text-[13px] leading-[1.3]">
                  Local dev
                  <br />
                  <span className="text-xs text-fg-4">Auth disabled</span>
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
