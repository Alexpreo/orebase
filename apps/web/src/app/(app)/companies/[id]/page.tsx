import Link from "next/link";
import { notFound } from "next/navigation";
import { EventFeed } from "@/components/intel/event-feed";
import { ProjectCard } from "@/components/intel/project-card";
import { WatchButton } from "@/components/intel/watch-button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCompany, listCompanyFilings, listCompanyProjects, listCompanyEvents } from "@/lib/intel";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const company = await getCompany(id);
  if (!company) notFound();

  const [projects, filings, events] = await Promise.all([
    listCompanyProjects(id),
    listCompanyFilings(id),
    listCompanyEvents(id),
  ]);

  const tickers = Array.isArray(company.tickers)
    ? (company.tickers as { exchange?: string; symbol?: string }[])
    : [];

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{company.name}</h1>
          <div className="mt-2 flex flex-wrap gap-2">
            {company.cik ? <Badge variant="outline">CIK {company.cik}</Badge> : null}
            {tickers.map((ticker) => (
              <Badge key={`${ticker.exchange}-${ticker.symbol}`} variant="secondary">
                {ticker.exchange ? `${ticker.exchange}:` : ""}
                {ticker.symbol}
              </Badge>
            ))}
            {company.hq_country ? (
              <Badge variant="outline">{company.hq_country}</Badge>
            ) : null}
          </div>
        </div>
        <WatchButton companyId={id} />
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Projects</h2>
        {projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">No projects linked yet.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Activity</CardTitle>
          <CardDescription>Events across this issuer’s projects.</CardDescription>
        </CardHeader>
        <CardContent>
          <EventFeed events={events} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filings</CardTitle>
          <CardDescription>Documents resolved to this issuer.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {filings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No filings linked.</p>
          ) : (
            filings.map((filing) => (
              <div key={filing.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <Link href={`/documents/${filing.id}`} className="hover:underline">
                  {filing.title ?? "Untitled"}
                </Link>
                <span className="text-muted-foreground">
                  {filing.doc_type ?? "unknown"} · {formatDate(filing.filed_at)}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
