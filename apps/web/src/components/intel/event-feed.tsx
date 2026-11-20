import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { EventRow } from "@/lib/intel-types";
import { documentHref, formatDate, humanize } from "@/lib/utils";

type FeedEvent = EventRow & { types: string[] };

/** One filing can emit several events (new report + resource update); show it once. */
export function mergeByFiling(events: EventRow[]): FeedEvent[] {
  const out = new Map<string, FeedEvent>();
  for (const e of events) {
    const key = e.document_id ? `${e.project_id}|${e.document_id}` : e.id;
    const prev = out.get(key);
    const type = e.event_type ?? "event";
    if (!prev) out.set(key, { ...e, types: [type] });
    else {
      if (!prev.types.includes(type)) prev.types.push(type);
      prev.isNew = prev.isNew || e.isNew;
      prev.change = prev.change ?? e.change;
    }
  }
  return [...out.values()];
}

export function EventFeedItem({ event }: { event: FeedEvent }) {
  const href = documentHref(event.document_id);
  return (
    <li className="flex flex-col gap-1 border-b py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {event.types.map((t) => (
          <Badge key={t} variant="secondary">{humanize(t)}</Badge>
        ))}
        {event.isNew ? <Badge>New</Badge> : null}
        <span className="text-muted-foreground">{formatDate(event.event_date)}</span>
        <Link href={`/projects/${event.project_id}`} className="font-medium hover:underline">
          {event.project_name}
        </Link>
        {event.company_name ? (
          <span className="text-muted-foreground">{event.company_name}</span>
        ) : null}
      </div>
      {event.change ? <p className="text-sm font-medium text-copper-2">{event.change}</p> : null}
      {event.summary ? (
        <p className="line-clamp-3 text-sm text-muted-foreground">{event.summary}</p>
      ) : null}
      {href ? (
        <Link href={href} className="text-xs hover:underline">
          Open report
        </Link>
      ) : null}
    </li>
  );
}

export function EventFeed({ events }: { events: EventRow[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">No events yet.</p>;
  }
  return (
    <ul>
      {mergeByFiling(events).map((event) => (
        <EventFeedItem key={event.id} event={event} />
      ))}
    </ul>
  );
}
