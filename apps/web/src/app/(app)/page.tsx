import Link from "next/link";
import { EventFeed } from "@/components/intel/event-feed";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ensureUserId, resolveClerkId } from "@/lib/chat";
import {
  corpusCounts,
  ensureDefaultWatchlist,
  listRecentEvents,
  listRecentFilings,
  listWatchlistEvents,
} from "@/lib/intel";
import type { FilingRow } from "@/lib/intel-types";
import { documentHref, formatDate, formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Server component renders once per request, so reading the clock here is fine.
function filedThisWeek(filings: FilingRow[]): FilingRow[] {
  const weekAgo = Date.now() - WEEK_MS;
  return filings.filter((f) => f.filed_at && new Date(f.filed_at).getTime() >= weekAgo);
}

export default async function HomePage() {
  const userId = await ensureUserId(await resolveClerkId());
  const watchlist = await ensureDefaultWatchlist(userId);
  const [counts, filings, resourceEvents, watchEvents] = await Promise.all([
    corpusCounts(),
    listRecentFilings(),
    listRecentEvents("resource_update", 6),
    // Read-only: the watchlist page owns markWatchlistSeen, so New badges survive.
    listWatchlistEvents(watchlist.id, watchlist.last_seen_at),
  ]);

  const thisWeek = filedThisWeek(filings);
  const shownFilings = (thisWeek.length > 0 ? thisWeek : filings).slice(0, 6);

  const questions = [
    ...resourceEvents.slice(0, 3).map(
      (e) => `What is the latest measured and indicated resource at ${e.project_name}?`,
    ),
    "Which projects have the highest-grade drill intercepts this year?",
  ];

  const stats = [
    { label: "Filings", value: counts.documents, href: "/documents" },
    { label: "Companies", value: counts.companies, href: "/companies" },
    { label: "Projects", value: counts.projects, href: "/screener" },
    { label: "Resource rows", value: counts.resources, href: "/screener" },
    { label: "Drill intercepts", value: counts.drills, href: "/research" },
  ];

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-muted-foreground">
          What changed in the corpus, and where to start.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <Link key={s.label} href={s.href}>
            <Card size="sm" className="transition-colors hover:bg-muted/50">
              <CardContent>
                <div className="text-2xl font-semibold tabular-nums">
                  {formatNumber(s.value)}
                </div>
                <div className="text-xs text-muted-foreground">{s.label}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ask OreBase</CardTitle>
          <CardDescription>Answers cite the filing and page they came from.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {questions.map((q) => (
            <Link
              key={q}
              href={`/chat?q=${encodeURIComponent(q)}`}
              className="rounded-full border px-3 py-1.5 text-sm hover:bg-muted"
            >
              {q}
            </Link>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {thisWeek.length > 0 ? "New filings this week" : "Latest filings"}
            </CardTitle>
            <CardDescription>
              {thisWeek.length > 0
                ? `${thisWeek.length} filed in the last 7 days.`
                : "Nothing filed in the last 7 days."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {shownFilings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No filings yet.</p>
            ) : (
              <ul>
                {shownFilings.map((f) => {
                  const href = documentHref(f.id);
                  return (
                    <li key={f.id} className="flex flex-col gap-1 border-b py-3 last:border-b-0">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        {f.doc_type ? <Badge variant="secondary">{f.doc_type}</Badge> : null}
                        <span className="text-muted-foreground">{formatDate(f.filed_at)}</span>
                        {f.company_name ? <span className="font-medium">{f.company_name}</span> : null}
                      </div>
                      {href ? (
                        <Link href={href} className="text-sm hover:underline">
                          {f.title ?? f.project_name ?? "Untitled filing"}
                        </Link>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Latest resource and reserve updates</CardTitle>
            <CardDescription>From extracted technical reports.</CardDescription>
          </CardHeader>
          <CardContent className="[&_p]:line-clamp-2">
            <EventFeed events={resourceEvents} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Watchlist activity</CardTitle>
          <CardDescription>
            <Link href="/watchlist" className="hover:underline">
              Open watchlist
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {watchEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing watched yet. Find projects in the{" "}
              <Link href="/screener" className="underline">
                screener
              </Link>{" "}
              and add them from their page.
            </p>
          ) : (
            <EventFeed events={watchEvents.slice(0, 5)} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
