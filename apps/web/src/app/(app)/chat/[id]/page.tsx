import { notFound } from "next/navigation";
import { ChatClient } from "@/components/chat/chat-client";
import { getChatMessages } from "@/lib/chat";
import { isDocumentUuid } from "@/lib/citations";

export const dynamic = "force-dynamic";

type ChatIdPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string }>;
};

export default async function ChatIdPage({ params, searchParams }: ChatIdPageProps) {
  const { id } = await params;
  if (!isDocumentUuid(id)) {
    notFound();
  }

  const { q } = await searchParams;
  const initialMessages = await getChatMessages(id);

  return (
    <div className="h-[calc(100svh-3.5rem)]">
      <ChatClient
        key={id}
        chatId={id}
        initialMessages={initialMessages}
        initialInput={q ?? ""}
      />
    </div>
  );
}
