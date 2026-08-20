import Link from "next/link";
import { EventFeed } from "@/components/intel/event-feed";
import { WatchlistControls } from "@/components/intel/watchlist-controls";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ensureUserId, resolveClerkId } from "@/lib/chat";
import { getSql } from "@/lib/db";
import {
  ensureDefaultWatchlist,
  listWatchlistEvents,
  listWatchlistItems,
} from "@/lib/intel";

export const dynamic = "force-dynamic";

async function alertsEnabled(userId: string): Promise<boolean> {
  const sql = getSql();
  if (!sql) return false;
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM app.alerts
    WHERE user_id = ${userId} AND channel = 'in_app'
  `;
  return (rows[0]?.n ?? 0) > 0;
}

export default async function WatchlistPage() {
  const clerkId = await resolveClerkId();
  const userId = await ensureUserId(clerkId);
  const watchlist = await ensureDefaultWatchlist(userId);
  const [items, events, alertsOn] = await Promise.all([
    listWatchlistItems(watchlist.id),
    listWatchlistEvents(watchlist.id),
    alertsEnabled(userId),
  ]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Watchlist</h1>
          <p className="text-sm text-muted-foreground">
            Track companies and projects. Alerts are in-app and email when Resend is configured.
          </p>
        </div>
        <WatchlistControls alertsOn={alertsOn} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{watchlist.name}</CardTitle>
          <CardDescription>
            Add items from a company or project page.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing watched yet.</p>
          ) : (
            items.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-2 text-sm">
                <div>
                  {item.project_id ? (
                    <Link href={`/projects/${item.project_id}`} className="hover:underline">
                      {item.project_name ?? "Project"}
                    </Link>
                  ) : item.company_id ? (
                    <Link href={`/companies/${item.company_id}`} className="hover:underline">
                      {item.company_name ?? "Company"}
                    </Link>
                  ) : (
                    "Item"
                  )}
                </div>
                <WatchlistControls itemId={item.id} alertsOn={alertsOn} />
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Activity</CardTitle>
          <CardDescription>Events for watched companies and projects.</CardDescription>
        </CardHeader>
        <CardContent>
          <EventFeed events={events} />
        </CardContent>
      </Card>
    </div>
  );
}
