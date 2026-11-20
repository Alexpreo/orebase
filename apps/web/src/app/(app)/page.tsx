import Link from "next/link";
import { StackedBars, MiniBars, SERIES } from "@/components/charts/charts";
import { CountUp } from "@/components/kit/count-up";
import { EmptyState } from "@/components/kit/empty-state";
import { PageHeader } from "@/components/kit/page-header";
import { Panel, PanelLink } from "@/components/kit/panel";
import { Delta, StatTile } from "@/components/kit/stat-tile";
import { cookies } from "next/headers";
import { CommoditySwitch } from "@/components/home/commodity-switch";
import { NewStudies } from "@/components/home/new-studies";
import { PipelinePanel } from "@/components/home/pipeline";
import { ResourceMovers } from "@/components/home/resource-movers";
import { TopIntercepts } from "@/components/home/top-intercepts";
import { mergeByFiling } from "@/components/intel/event-feed";
import {
  COMMODITIES,
  dashboardCounts,
  newStudies,
  parseCommodity,
  pipeline,
  recentIntercepts,
  resourceMovers,
} from "@/lib/dashboard";
import { isAdmin } from "@/lib/admin-auth";
import { ensureUserId, resolveClerkId } from "@/lib/chat";
import {
  extractionMonthlyCap,
  extractionSpend,
  homeBriefing,
  listLatestReports,
  listWatchlists,
  listWatchlistEvents,
} from "@/lib/intel";
import type { EventRow } from "@/lib/intel-types";
import { formatAgo, formatShortDate, humanize } from "@/lib/utils";

export const dynamic = "force-dynamic";

const ASK_PROMPTS = [
  "Summarize this week's new NI 43-101 reports",
  "Rank BC copper projects by contained metal",
  "Which PEAs this quarter have IRR above 30%?",
];

const REPORT_LABEL: Record<string, string> = {
  ni43101: "NI 43-101 report",
  sk1300: "S-K 1300 summary",
  pea: "PEA",
  pfs: "Pre-feasibility study",
  fs: "Feasibility study",
};

const EVENT_TONE: Record<string, { text: string; dot: string }> = {
  resource_update: { text: "text-copper-2", dot: "bg-copper" },
  drill_result: { text: "text-slate-2", dot: "bg-slate" },
  drill_results: { text: "text-slate-2", dot: "bg-slate" },
};

async function watchlistActivity(): Promise<{ watching: boolean; events: EventRow[] }> {
  try {
    const userId = await ensureUserId(await resolveClerkId());
    const [list] = await listWatchlists(userId);
    if (!list) return { watching: false, events: [] };
    // Read-only: the watchlist page owns markWatchlistSeen, so unread state survives.
    return { watching: true, events: await listWatchlistEvents(list.id, list.last_seen_at) };
  } catch {
    return { watching: false, events: [] };
  }
}

// Server component renders once per request, so reading the clock here is fine.
function now() {
  return Date.now();
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const param = (await searchParams).c;
  // ?c= wins (shared links); otherwise the remembered choice; "all" clears it.
  const raw = typeof param === "string" ? param : (await cookies()).get("home_commodity")?.value;
  const commodity = parseCommodity(raw);
  const scope = COMMODITIES.find((c) => c.code === commodity) ?? null;
  const scopeWord = scope ? `${scope.label.toLowerCase()} ` : "";

  const [briefing, reports, spend, watch, admin, counts, movers, studies, intercepts, pipe] = await Promise.all([
    homeBriefing(),
    listLatestReports(7, commodity),
    extractionSpend(),
    watchlistActivity(),
    isAdmin(),
    dashboardCounts(commodity),
    resourceMovers(commodity),
    newStudies(commodity),
    recentIntercepts(commodity),
    pipeline(commodity),
  ]);
  const nowMs = now();
  const cap = extractionMonthlyCap();

  const week = briefing.last7.reduce((a, d) => a + d.n, 0);
  const unread = watch.events.filter((e) => e.isNew);
  const unreadResource = unread.filter((e) => e.event_type === "resource_update").length;
  const pulseTotal = briefing.pulse.reduce((a, w) => a + w.sedar + w.edgar, 0);
  const month = new Date(nowMs).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
  const today = new Date(nowMs).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  const spendPct = Math.min(100, (spend.monthly / cap) * 100);

  return (
    <main className="flex flex-col gap-6 px-[clamp(16px,3vw,44px)] pt-8 pb-14">
      <PageHeader
        eyebrow={today}
        title="Daily briefing"
        subtitle={
          <>
            <span className="num text-fg">{week}</span> technical reports filed in the last 7 days ·{" "}
            <span className="num text-copper-2">{unread.length}</span> new watchlist events
          </>
        }
        actions={
          <Link
            href="/chat"
            className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-copper px-4 text-[13px] font-semibold text-on-copper transition-colors hover:bg-copper-hover"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z" />
            </svg>
            Ask OreBase
          </Link>
        }
      />

      <CommoditySwitch options={COMMODITIES} active={commodity} />

      <section aria-label="Key figures" className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-3.5">
        {scope ? (
          <StatTile
            className="rise d1"
            label={`New ${scope.label.toLowerCase()} reports · 7d`}
            value={<CountUp value={counts.reports7d} />}
            foot="Technical reports on projects with this commodity"
          />
        ) : (
          <StatTile
            className="rise d1"
            label="New technical reports · 7d"
            value={<CountUp value={week} />}
            chart={
              <MiniBars
                values={briefing.last7.map((d) => d.n)}
                label={`Reports per day, last 7 days: ${briefing.last7.map((d) => d.n).join(", ")}`}
              />
            }
            foot={<Delta value={week - briefing.prior7} suffix="vs prior week" />}
          />
        )}
        <StatTile
          className="rise d2"
          label="New studies · 90d"
          value={<CountUp value={counts.studies90d} />}
          foot="PEA, PFS and FS reports with economics"
        />
        <StatTile
          className="rise d2"
          label="Resource updates · 90d"
          value={<CountUp value={counts.resourceUpdates90d} />}
          foot={(() => {
            const compared = movers.filter((m) => m.delta).length;
            return compared ? `${compared} compared with an earlier estimate` : "None with an earlier estimate on file yet";
          })()}
        />
        <StatTile
          className="rise d3"
          label="Watchlist events"
          value={<CountUp value={unread.length} />}
          unit="unread"
          foot={
            !watch.watching || watch.events.length === 0 ? (
              "Nothing watched yet"
            ) : unreadResource > 0 ? (
              <span className="text-copper-2">{unreadResource} high-signal: resource updates</span>
            ) : (
              `${watch.events.length} events on watched projects`
            )
          }
        />
        {admin ? (
        <StatTile
          className="rise d4"
          label={`Extraction spend · ${month}`}
          value={<CountUp value={spend.monthly} decimals={2} prefix="$" />}
          unit={<span className="num">/ ${cap}</span>}
          foot={
            <div
              className="h-1.5 overflow-hidden rounded-full bg-track"
              role="meter"
              aria-label="Share of monthly extraction cap used"
              aria-valuemin={0}
              aria-valuemax={cap}
              aria-valuenow={Number(spend.monthly.toFixed(2))}
            >
              <div className="h-full rounded-full bg-copper" style={{ width: `${spendPct}%` }} />
            </div>
          }
        />
        ) : null}
      </section>

      <section className="flex flex-wrap gap-3.5">
        <Panel
          className="rise d5 flex-[3_1_520px]"
          title="Resource updates"
          subtitle={`Estimates filed in the last 90 days, biggest changes first${scope ? ` · ${scope.label}` : ""}`}
        >
          <ResourceMovers movers={movers} empty={`No ${scopeWord}resource estimates filed in the last 90 days.`} />
        </Panel>
        <Panel
          flush
          className="rise d5 flex-[4_1_560px] pb-2"
          title="New studies"
          subtitle="PEAs, pre-feasibility and feasibility studies filed in the last 90 days"
          action={<PanelLink href={`/screener${scope ? `?commodity=${scope.code}` : ""}`}>Compare in screener →</PanelLink>}
        >
          <NewStudies studies={studies} empty={`No ${scopeWord}studies filed in the last 90 days.`} />
        </Panel>
      </section>

      <section className="flex flex-wrap gap-3.5">
        <Panel
          className="rise d6 flex-[3_1_560px]"
          title="Top drill intercepts"
          subtitle="Best intercepts filed in the last 30 days, one per hole"
        >
          <TopIntercepts rows={intercepts} gradeKey={scope?.key ?? null} label={scope?.label ?? null} />
        </Panel>
        <Panel
          className="rise d6 flex-[2_1_420px]"
          title="Pipeline"
          subtitle={`Where new reports are coming from · last 90 days${scope ? ` · ${scope.label}` : ""}`}
        >
          <PipelinePanel data={pipe} empty={`No ${scopeWord}technical reports filed in the last 90 days.`} />
        </Panel>
      </section>

      <section className="flex flex-wrap gap-3.5">
        <Panel
          flush
          className="rise d6 flex-[3_1_600px] pb-2"
          title="Latest technical reports"
          action={<PanelLink href="/documents">View all documents →</PanelLink>}
        >
          {reports.length === 0 ? (
            <div className="px-5 pb-3">
              <EmptyState title="No technical reports yet" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] border-collapse text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] tracking-[0.06em] text-fg-4 uppercase">
                    <th scope="col" className="w-[38%] min-w-[220px] px-5 py-2 font-semibold">Project</th>
                    <th scope="col" className="px-3 py-2 font-semibold">What it says</th>
                    <th scope="col" className="px-5 py-2 text-right font-semibold">Filed</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((r) => (
                    <tr key={r.id} className="border-t border-line-soft transition-colors hover:bg-hover">
                      <td className="px-5 py-3 align-top">
                        <Link
                          href={r.project_id ? `/projects/${r.project_id}` : `/documents/${r.id}`}
                          className="font-medium text-fg hover:text-copper-2"
                        >
                          {r.project_name ?? r.company_name ?? r.title ?? "Unknown issuer"}
                        </Link>
                        <div className="text-xs text-fg-3">
                          {[r.project_name ? r.company_name : null, r.region ?? r.country, REPORT_LABEL[r.doc_type ?? ""]]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top text-fg-2">
                        {r.summary ? (
                          <Link href={`/documents/${r.id}`} className="line-clamp-2 hover:text-fg">
                            {r.summary}
                          </Link>
                        ) : (
                          <Link href={`/documents/${r.id}`} className="text-fg-3 hover:text-fg">
                            Not summarized yet · open report
                          </Link>
                        )}
                      </td>
                      <td className="num px-5 py-3 text-right align-top whitespace-nowrap text-fg-2">{formatShortDate(r.filed_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel
          className="rise d7 flex-[2_1_380px] gap-1"
          title="Watchlist activity"
          action={<PanelLink href="/watchlist">Open →</PanelLink>}
        >
          {watch.events.length === 0 ? (
            <EmptyState title="Nothing watched yet" className="mt-2">
              Find projects in the{" "}
              <Link href="/screener" className="text-copper hover:text-copper-2">
                Screener
              </Link>{" "}
              and watch them from their page.
            </EmptyState>
          ) : (
            <ul className="flex flex-col pt-2">
              {mergeByFiling(watch.events).slice(0, 4).map((e) => {
                const tone = EVENT_TONE[e.event_type ?? ""] ?? { text: "text-fg-2", dot: "bg-fg-4" };
                return (
                  <li key={e.id}>
                    <Link
                      href={`/projects/${e.project_id}`}
                      className="flex gap-3 rounded-[10px] px-2 py-3 text-fg transition-colors hover:bg-hover"
                    >
                      <span aria-hidden="true" className={`mt-1.5 size-2 flex-none rounded-full ${tone.dot}`} />
                      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                        <span className={`text-[11px] font-semibold tracking-[0.06em] uppercase ${tone.text}`}>
                          {humanize(e.event_type ?? "event")}
                        </span>
                        <span className="text-sm font-medium">
                          {e.project_name}
                          {e.company_name ? ` · ${e.company_name}` : ""}
                        </span>
                        {e.change ? <span className="text-[13px] text-copper-2">{e.change}</span> : null}
                        {e.summary ? <span className="line-clamp-2 text-[13px] text-fg-3">{e.summary}</span> : null}
                      </span>
                      <span className="num text-xs whitespace-nowrap text-fg-4">
                        {e.event_date ? formatAgo(e.event_date, nowMs) : ""}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </section>

      <section className="flex flex-wrap gap-3.5">
        <Panel
          className="rise d5 flex-[2_1_560px]"
          title="Filings pulse"
          subtitle="Technical reports filed per week, last 12 weeks"
          action={
            <div className="flex gap-4 text-xs text-fg-2">
              <Legend color={SERIES.copper} label="SEDAR+" />
              <Legend color={SERIES.slate} label="EDGAR" />
            </div>
          }
        >
          {pulseTotal === 0 ? (
            <EmptyState title="No technical reports filed in the last 12 weeks">
              New filings appear here as the pollers ingest them.
            </EmptyState>
          ) : (
            <StackedBars
              series={[
                { name: "SEDAR+", color: SERIES.copper },
                { name: "EDGAR", color: SERIES.slate },
              ]}
              data={briefing.pulse.map((w, i) => ({
                label: i === briefing.pulse.length - 1 ? "Now" : i % 2 === 0 ? formatShortDate(w.week_start) : "",
                highlight: i === briefing.pulse.length - 1,
                values: [w.sedar, w.edgar],
              }))}
              label={`Weekly technical report filings over 12 weeks, ${pulseTotal} in total: ${briefing.pulse
                .map((w) => `week of ${formatShortDate(w.week_start)} ${w.sedar} SEDAR+ and ${w.edgar} EDGAR`)
                .join("; ")}`}
            />
          )}
        </Panel>

        <section className="rise d6 flex min-w-0 flex-[1_1_320px] flex-col gap-3.5 rounded-2xl border border-[#2E2419] bg-[linear-gradient(180deg,#16120E_0%,#12151A_60%)] p-5">
          <h2 className="font-heading text-lg font-semibold">Ask OreBase</h2>
          <form action="/chat" className="flex flex-col gap-3.5">
            <label htmlFor="home-ask" className="text-[13px] text-fg-3">
              Every answer cites the exact page it came from.
            </label>
            <div className="relative">
              <textarea
                id="home-ask"
                name="q"
                rows={3}
                required
                placeholder="Ask about any filing, project or company…"
                className="block w-full resize-none rounded-[10px] border border-line-3 bg-nav p-3 pr-12 text-sm text-fg placeholder:text-fg-4 focus-visible:border-copper focus-visible:outline-none"
              />
              <button
                type="submit"
                aria-label="Ask"
                className="absolute right-2 bottom-2 grid size-8 place-items-center rounded-lg bg-copper text-on-copper transition-colors hover:bg-copper-hover"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </svg>
              </button>
            </div>
          </form>
          <div className="flex flex-col gap-2">
            {ASK_PROMPTS.map((q) => (
              <Link
                key={q}
                href={`/chat?q=${encodeURIComponent(q)}`}
                className="block rounded-[10px] border border-line-3 px-3 py-2.5 text-[13px] text-fg-2 transition-colors duration-(--duration-quick) hover:border-copper hover:text-copper-2"
              >
                {q}
              </Link>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className="size-2.5 rounded-[3px]" style={{ background: color }} />
      {label}
    </span>
  );
}
