import Link from "next/link";
import { notFound } from "next/navigation";
import { ExtractButton } from "@/components/admin/extract-button";
import { EconomicsTable } from "@/components/intel/economics-table";
import { MiniMap } from "@/components/intel/mini-map";
import { EventFeed } from "@/components/intel/event-feed";
import { ResourceTable } from "@/components/intel/resource-table";
import { WatchButton } from "@/components/intel/watch-button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getProject,
  listProjectEconomics,
  listProjectEvents,
  listProjectFilings,
  listProjectResources,
} from "@/lib/intel";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const [resources, economics, events, filings] = await Promise.all([
    listProjectResources(id),
    listProjectEconomics(id),
    listProjectEvents(id),
    listProjectFilings(id),
  ]);

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
              <span>Unlinked company</span>
            )}
            {project.stage ? <Badge variant="secondary">{project.stage}</Badge> : null}
            {project.country ? <Badge variant="outline">{project.country}</Badge> : null}
            {(project.commodities ?? []).map((commodity) => (
              <Badge key={commodity} variant="outline">
                {commodity}
              </Badge>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExtractButton projectId={id} />
          <WatchButton projectId={id} />
        </div>
      </div>

      <MiniMap
        points={[
          {
            id: project.id,
            name: project.name,
            lat: project.lat,
            lng: project.lng,
          },
        ]}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Resources</CardTitle>
          <CardDescription>Extracted mineral resources and reserves.</CardDescription>
        </CardHeader>
        <CardContent>
          <ResourceTable rows={resources} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Economics</CardTitle>
          <CardDescription>PEA / PFS / FS metrics with source filings.</CardDescription>
        </CardHeader>
        <CardContent>
          <EconomicsTable rows={economics} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Events</CardTitle>
        </CardHeader>
        <CardContent>
          <EventFeed events={events} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Documents</CardTitle>
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
                <span className="text-muted-foreground">{formatDate(filing.filed_at)}</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
