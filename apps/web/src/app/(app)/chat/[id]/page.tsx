import { notFound } from "next/navigation";
import { ChatClient } from "@/components/chat/chat-client";
import { getChatMessages } from "@/lib/chat";
import { isDocumentUuid } from "@/lib/citations";

export const dynamic = "force-dynamic";

type ChatIdPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    q?: string;
    company?: string;
    doc_type?: string;
    date_from?: string;
    date_to?: string;
  }>;
};

export default async function ChatIdPage({ params, searchParams }: ChatIdPageProps) {
  const { id } = await params;
  if (!isDocumentUuid(id)) {
    notFound();
  }

  const query = await searchParams;
  const initialMessages = await getChatMessages(id);

  return (
    <div className="h-[calc(100svh-3.5rem)]">
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
      />
    </div>
  );
}
