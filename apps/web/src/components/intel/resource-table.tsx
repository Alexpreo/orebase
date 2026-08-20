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
import { documentHref, formatDate, formatGrade, formatNumber, formatTonnes } from "@/lib/utils";

export function ResourceTable({ rows }: { rows: ResourceRow[] }) {
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
            <TableHead>Effective</TableHead>
            <TableHead>Standard</TableHead>
            <TableHead className="text-right">Conf.</TableHead>
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
                    <span className="capitalize">{row.category ?? "—"}</span>
                    {!row.reviewed ? (
                      <Badge variant="outline">unreviewed</Badge>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatTonnes(row.tonnes)}
                </TableCell>
                <TableCell>{formatGrade(row.grade)}</TableCell>
                <TableCell>{formatDate(row.effective_date)}</TableCell>
                <TableCell>{row.standard ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.extraction_confidence == null
                    ? "—"
                    : formatNumber(row.extraction_confidence, 2)}
                </TableCell>
                <TableCell>
                  {href ? (
                    <Link href={href} className="text-sm hover:underline">
                      Filing
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
