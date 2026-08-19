import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { citationHref } from "@/lib/citations";
import type { Citation } from "@/lib/chat-types";

export function CitationChips({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) return null;

  return (
    <div className="flex max-w-[85%] flex-wrap gap-1.5">
      {citations.map((citation) => (
        <Badge
          key={citation.label}
          variant="secondary"
          className="font-mono text-xs"
          title={`Open document at page ${citation.pageStart ?? 1}`}
          render={
            <Link
              href={citationHref(citation)}
              target="_blank"
              rel="noreferrer"
            />
          }
        >
          {citation.label}
        </Badge>
      ))}
    </div>
  );
}
