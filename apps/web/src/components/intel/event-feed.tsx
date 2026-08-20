import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { EventRow } from "@/lib/intel-types";
import { documentHref, formatDate } from "@/lib/utils";

export function EventFeedItem({ event }: { event: EventRow }) {
  const href = documentHref(event.document_id);
  return (
    <li className="flex flex-col gap-1 border-b py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="secondary">{event.event_type ?? "event"}</Badge>
        <span className="text-muted-foreground">{formatDate(event.event_date)}</span>
        <Link href={`/projects/${event.project_id}`} className="font-medium hover:underline">
          {event.project_name}
        </Link>
        {event.company_name ? (
          <span className="text-muted-foreground">{event.company_name}</span>
        ) : null}
      </div>
      {event.summary ? (
        <p className="text-sm text-muted-foreground">{event.summary}</p>
      ) : null}
      {href ? (
        <Link href={href} className="text-xs hover:underline">
          Open filing
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
      {events.map((event) => (
        <EventFeedItem key={event.id} event={event} />
      ))}
    </ul>
  );
}
