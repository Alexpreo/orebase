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
import type { EconomicsRow } from "@/lib/intel-types";
import { documentHref, formatDate, formatNumber } from "@/lib/utils";

function npvLabel(npv: Record<string, number> | null | undefined): string {
  if (!npv) return "—";
  const entries = Object.entries(npv).filter(([, v]) => Number.isFinite(v));
  if (entries.length === 0) return "—";
  return entries
    .map(([key, value]) => `${key}: ${formatNumber(value, 0)}`)
    .join("; ");
}

export function EconomicsTable({ rows }: { rows: EconomicsRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No economics extracted yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Study</TableHead>
            <TableHead>NPV</TableHead>
            <TableHead className="text-right">IRR</TableHead>
            <TableHead className="text-right">Capex</TableHead>
            <TableHead className="text-right">Life</TableHead>
            <TableHead>Effective</TableHead>
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
                    <span className="uppercase">{row.study_type ?? "—"}</span>
                    {row.currency ? (
                      <Badge variant="outline">{row.currency}</Badge>
                    ) : null}
                    {!row.reviewed ? (
                      <Badge variant="outline">unreviewed</Badge>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>{npvLabel(row.npv)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.irr_pct == null ? "—" : `${formatNumber(row.irr_pct)}%`}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(row.capex_initial, 0)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.mine_life_years == null ? "—" : `${formatNumber(row.mine_life_years, 1)} yr`}
                </TableCell>
                <TableCell>{formatDate(row.effective_date)}</TableCell>
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
