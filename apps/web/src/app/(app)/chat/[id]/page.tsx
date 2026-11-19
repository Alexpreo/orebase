import { notFound } from "next/navigation";
import { ChatClient } from "@/components/chat/chat-client";
import { getChatMessages } from "@/lib/chat";
import { collectCitations, isDocumentUuid } from "@/lib/citations";
import { getDocumentMeta } from "@/lib/documents";
import { corpusCounts } from "@/lib/intel";

export const dynamic = "force-dynamic";

type ChatIdPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    q?: string;
    company?: string;
    doc_type?: string;
    date_from?: string;
    date_to?: string;
    src?: string;
  }>;
};

export default async function ChatIdPage({ params, searchParams }: ChatIdPageProps) {
  const { id } = await params;
  if (!isDocumentUuid(id)) {
    notFound();
  }

  const query = await searchParams;
  const [initialMessages, counts] = await Promise.all([getChatMessages(id), corpusCounts().catch(() => null)]);
  const cited = new Set<string>();
  for (const m of initialMessages) {
    for (const c of m.metadata?.citations ?? collectCitations([m])) cited.add(c.documentId);
  }
  const docMeta = await getDocumentMeta([...cited]);
  const src = Number.parseInt(query.src ?? "", 10);

  return (
    <div className="h-[calc(100dvh-3.5rem)] md:h-dvh">
      <ChatClient
        key={id}
        chatId={id}
        initialMessages={initialMessages}
        initialInput={query.q ?? ""}
        initialFilters={{
          company: query.company,
          docType: query.doc_type,
          dateFrom: query.date_from,
          dateTo: query.date_to,
        }}
        initialSource={Number.isFinite(src) && src > 0 ? src : null}
        docMeta={docMeta}
        documentCount={counts?.documents ?? null}
      />
    </div>
  );
}
