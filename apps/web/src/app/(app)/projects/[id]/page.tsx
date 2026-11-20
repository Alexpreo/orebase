import Link from "next/link";
import { notFound } from "next/navigation";
import { ExtractButton } from "@/components/admin/extract-button";
import { DrillResults } from "@/components/intel/drill-results";
import { EventFeed } from "@/components/intel/event-feed";
import { MiniMap } from "@/components/intel/mini-map";
import { ResourceHistory } from "@/components/intel/resource-history";
import { StudyProgression } from "@/components/intel/study-progression";
import { WatchButton } from "@/components/intel/watch-button";
import { Panel } from "@/components/kit/panel";
import { StatTile } from "@/components/kit/stat-tile";
import { Badge } from "@/components/ui/badge";
import { isAdmin } from "@/lib/admin-auth";
import { economicsProgression } from "@/lib/history";
import {
  getProject,
  listProjectDrills,
  listProjectEconomics,
  listProjectEvents,
  listProjectFilings,
  listProjectResources,
} from "@/lib/intel";
import { docTypeLabel, formatDate, formatMoneyM, formatNumber, stageLabel, studyLabel } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const [resources, economics, events, filings, drills, admin] = await Promise.all([
    listProjectResources(id),
    listProjectEconomics(id),
    listProjectEvents(id),
    listProjectFilings(id),
    listProjectDrills(id),
    isAdmin(),
  ]);

  const studies = economicsProgression(economics);
  const study = studies[studies.length - 1];
  const hasMap = project.lat != null && project.lng != null;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {project.company_id && project.company_name ? (
              <Link href={`/companies/${project.company_id}`} className="hover:underline">
                {project.company_name}
              </Link>
            ) : (
              <span>Company not identified</span>
            )}
            {project.stage ? <Badge variant="secondary">{stageLabel(project.stage)}</Badge> : null}
            {project.country ? <Badge variant="outline">{project.country}</Badge> : null}
            {(project.commodities ?? []).map((commodity) => (
              <Badge key={commodity} variant="outline">
                {commodity}
              </Badge>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {admin ? <ExtractButton projectId={id} /> : null}
          <WatchButton projectId={id} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label={study ? `Latest study · ${studyLabel(study.row.study_type)}` : "Latest study"}
          value={study?.npv ? formatMoneyM(study.npv.value, study.row.currency) : "—"}
          foot={study?.npv ? `NPV, ${study.npv.basis} · ${formatDate(study.date)}` : "No study economics extracted"}
        />
        <StatTile
          label="IRR · initial capex"
          value={study?.row.irr_pct != null ? `${formatNumber(study.row.irr_pct, 1)}%` : "—"}
          foot={study ? `Capex ${formatMoneyM(study.row.capex_initial, study.row.currency)}` : "—"}
        />
        <StatTile
          label="Filings"
          value={filings.length}
          foot={filings[0] ? `Latest ${formatDate(filings[0].filed_at)}` : "None linked"}
        />
        <StatTile
          label="Drill intercepts"
          value={drills.length}
          foot={drills[0] ? `Latest ${formatDate(drills[0].announced_date)}` : "None extracted"}
        />
      </div>

      <Panel title="Mineral resources" subtitle="Latest estimate and how it changed from the one before.">
        <ResourceHistory rows={resources} />
      </Panel>

      <Panel title="Study economics" subtitle="Each study side by side, oldest to newest.">
        <StudyProgression rows={economics} />
      </Panel>

      {drills.length ? (
        <Panel title="Drill results" subtitle={`${drills.length} intercepts from this project's filings.`}>
          <DrillResults rows={drills} />
        </Panel>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Filing timeline" subtitle="What each report says, newest first.">
          {filings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No filings linked.</p>
          ) : (
            <ol className="flex flex-col gap-4">
              {filings.map((filing) => (
                <li key={filing.id} className="border-l-2 border-line pl-3">
                  <div className="flex flex-wrap items-baseline gap-2 text-sm">
                    <span className="text-fg-3 tabular-nums">{formatDate(filing.filed_at)}</span>
                    <Link href={`/documents/${filing.id}`} className="font-medium hover:underline">
                      {docTypeLabel(filing.doc_type)}
                    </Link>
                  </div>
                  {filing.summary ? (
                    <p className="mt-1 line-clamp-4 text-[13px] text-fg-2">{filing.summary}</p>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </Panel>
        <div className="flex flex-col gap-6">
          <Panel title="Events">
            <EventFeed events={events} />
          </Panel>
          {hasMap ? (
            <MiniMap points={[{ id: project.id, name: project.name, lat: project.lat, lng: project.lng }]} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
