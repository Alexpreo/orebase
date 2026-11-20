import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ProjectFigures } from "@/components/intel/project-figures";
import type { Snapshot } from "@/lib/history";
import type { ProjectSummary } from "@/lib/intel-types";
import { stageLabel } from "@/lib/utils";

export function ProjectCard({ project, snap }: { project: ProjectSummary; snap?: Snapshot }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>
          <Link href={`/projects/${project.id}`} className="hover:underline">
            {project.name}
          </Link>
        </CardTitle>
        <CardDescription>
          {project.company_id && project.company_name ? (
            <Link href={`/companies/${project.company_id}`} className="hover:underline">
              {project.company_name}
            </Link>
          ) : (
            (project.company_name ?? "Unlinked company")
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <ProjectFigures snap={snap} />
        <div className="flex flex-wrap gap-1.5">
        {project.stage ? <Badge variant="secondary">{stageLabel(project.stage)}</Badge> : null}
        {project.country ? <Badge variant="outline">{project.country}</Badge> : null}
        {project.region ? <Badge variant="outline">{project.region}</Badge> : null}
        {(project.commodities ?? []).map((commodity) => (
          <Badge key={commodity} variant="outline">
            {commodity}
          </Badge>
        ))}
        </div>
      </CardContent>
    </Card>
  );
}
