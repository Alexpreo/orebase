import { Sidebar, type IngestionChip } from "@/components/shell/sidebar";
import { ingestionStatus } from "@/lib/admin";
import { isAdmin } from "@/lib/admin-auth";
import { ensureUserId, listChats, resolveClerkId } from "@/lib/chat";
import { listWatchlists, listWatchlistEvents, reviewQueueCount } from "@/lib/intel";
import { formatAgo, SOURCE_LABEL } from "@/lib/utils";

// Rendered per-request so the Clerk-backed shell is never statically
// prerendered without credentials present.
export const dynamic = "force-dynamic";

async function watchlistUnread(): Promise<number> {
  try {
    const userId = await ensureUserId(await resolveClerkId());
    // Read-only: never create a watchlist from the shell.
    const [list] = await listWatchlists(userId);
    if (!list) return 0;
    const events = await listWatchlistEvents(list.id, list.last_seen_at);
    return events.filter((e) => e.isNew).length;
  } catch {
    return 0;
  }
}

// Server component renders once per request, so reading the clock here is fine.
function ingestionChip(status: Awaited<ReturnType<typeof ingestionStatus>>): IngestionChip {
  const latest = status.lastBySource[0];
  const detail = latest
    ? `${SOURCE_LABEL[latest.source] ?? latest.source} synced ${formatAgo(latest.last, Date.now())} ago`
    : "No documents yet";
  if (status.active > 0) return { live: true, title: "Ingestion live", detail };
  if (status.pending > 0) return { live: false, title: `${status.pending} jobs queued`, detail };
  return { live: false, title: "Ingestion idle", detail };
}

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [chats, showAdmin, unread, ingestion] = await Promise.all([
    listChats(),
    isAdmin(),
    watchlistUnread(),
    ingestionStatus(),
  ]);
  const review = showAdmin ? await reviewQueueCount() : 0;

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      {/* The wrapper carries the column background past the sticky, viewport-tall nav. */}
      <div className="sticky top-0 z-40 bg-nav md:static md:w-[clamp(248px,20vw,292px)] md:flex-none md:border-r md:border-line-soft">
      <Sidebar
        chats={chats}
        showAdmin={showAdmin}
        badges={{ watchlist: unread, review }}
        ingestion={ingestionChip(ingestion)}
        hasClerk={Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)}
      />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
