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
import {
  documentHref,
  formatDate,
  formatMoneyM,
  formatNpv,
  formatNumber,
  formatPerUnit,
  studyLabel,
} from "@/lib/utils";

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
            <TableHead className="text-right">Initial capex</TableHead>
            <TableHead>AISC</TableHead>
            <TableHead className="text-right">Life</TableHead>
            <TableHead className="text-right">Payback</TableHead>
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
                    <span>{studyLabel(row.study_type)}</span>
                    {!row.reviewed ? (
                      <Badge variant="outline" title="Extracted automatically and not yet checked against the report">
                        unverified
                      </Badge>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>{formatNpv(row.npv, row.currency)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.irr_pct == null ? "—" : `${formatNumber(row.irr_pct, 1)}%`}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoneyM(row.capex_initial, row.currency)}
                </TableCell>
                <TableCell>{formatPerUnit(row.aisc)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.mine_life_years == null ? "—" : `${formatNumber(row.mine_life_years, 1)} yr`}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.payback_years == null ? "—" : `${formatNumber(row.payback_years, 1)} yr`}
                </TableCell>
                <TableCell>{formatDate(row.effective_date)}</TableCell>
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
