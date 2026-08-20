import Link from "next/link";
import { ReviewActions, ReviewQueueToolbar } from "@/components/admin/review-actions";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listReviewQueue, listUnresolvedFilings } from "@/lib/intel";
import { AUTO_APPROVE_MIN } from "@/lib/intel-types";
import { documentHref, formatDate, formatNumber } from "@/lib/utils";
import type { ReviewItem } from "@/lib/intel-types";

export const dynamic = "force-dynamic";

function ReviewList({ items }: { items: ReviewItem[] }) {
  return (
    <div className="flex flex-col gap-4">
      {items.map((item) => {
        const href = documentHref(item.document_id);
        return (
          <Card key={`${item.kind}-${item.id}`}>
            <CardHeader>
              <CardTitle className="text-base">
                <Link href={`/projects/${item.project_id}`} className="hover:underline">
                  {item.project_name}
                </Link>
              </CardTitle>
              <CardDescription className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{item.kind}</Badge>
                <span>{item.label}</span>
                <span>
                  confidence{" "}
                  {item.extraction_confidence == null
                    ? "—"
                    : formatNumber(item.extraction_confidence, 2)}
                </span>
                {href ? (
                  <Link href={href} className="hover:underline">
                    Source filing
                  </Link>
                ) : null}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ReviewActions item={item} />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export default async function AdminReviewPage() {
  const [items, unresolved] = await Promise.all([
    listReviewQueue(),
    listUnresolvedFilings(),
  ]);
  const attention = items.filter((item) => item.attention);
  const rest = items.filter((item) => !item.attention);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Extraction review</h1>
          <p className="text-sm text-muted-foreground">
            Low-confidence rows first. Qualified persons are not in this queue.
          </p>
        </div>
        <ReviewQueueToolbar minConfidence={AUTO_APPROVE_MIN} remaining={rest.length} />
      </div>

      {unresolved.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Unresolved filings</CardTitle>
            <CardDescription>
              Indexed documents with no project. Re-run extract after a named project is
              in the first pages, or link them by hand.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {unresolved.map((row) => (
              <div key={row.id} className="flex flex-wrap justify-between gap-2">
                <Link href={`/documents/${row.id}`} className="hover:underline">
                  {row.title ?? row.id}
                </Link>
                <span className="text-muted-foreground">
                  {row.company_name ?? "unknown company"} · {formatDate(row.filed_at)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {items.length === 0 && unresolved.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Queue empty</CardTitle>
            <CardDescription>
              No unreviewed extractions. Run the extractor, then return here.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {attention.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium tracking-tight">
            Needs attention ({attention.length})
          </h2>
          <p className="text-sm text-muted-foreground">
            Confidence below 0.50. Spot-check against the source page before approving.
          </p>
          <ReviewList items={attention} />
        </section>
      ) : null}

      {rest.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium tracking-tight">
            Remaining ({rest.length})
          </h2>
          <ReviewList items={rest} />
        </section>
      ) : null}
    </div>
  );
}
