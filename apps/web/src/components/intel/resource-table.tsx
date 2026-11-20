import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ResourceRow } from "@/lib/intel-types";
import {
  categoryLabel,
  documentHref,
  formatContained,
  formatDate,
  formatGrade,
  formatTonnes,
} from "@/lib/utils";

export function ResourceTable({ rows, showDate = true }: { rows: ResourceRow[]; showDate?: boolean }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No resource estimates yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Category</TableHead>
            <TableHead className="text-right">Tonnes</TableHead>
            <TableHead>Grade</TableHead>
            <TableHead>Contained</TableHead>
            <TableHead>Cut-off</TableHead>
            {showDate ? <TableHead>Effective</TableHead> : null}
            <TableHead>Source</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const href = documentHref(row.document_id);
            return (
              <TableRow key={row.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span>{categoryLabel(row.category)}</span>
                    {row.domain ? (
                      <span className="text-xs text-muted-foreground">{row.domain}</span>
                    ) : null}
                    {!row.reviewed ? (
                      <Badge variant="outline" title="Extracted automatically and not yet checked against the report">
                        unverified
                      </Badge>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatTonnes(row.tonnes)}</TableCell>
                <TableCell>{formatGrade(row.grade)}</TableCell>
                <TableCell>{formatContained(row.contained_metal)}</TableCell>
                <TableCell className="text-muted-foreground">{row.cutoff ?? "—"}</TableCell>
                {showDate ? <TableCell>{formatDate(row.effective_date)}</TableCell> : null}
                <TableCell>
                  {href ? (
                    <Link href={href} className="text-sm hover:underline">
                      Report
                    </Link>
                  ) : (
                    "—"
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
