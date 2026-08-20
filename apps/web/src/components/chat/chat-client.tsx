"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { CitationChips } from "@/components/chat/citation-chips";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { collectCitations } from "@/lib/citations";
import type { OreBaseUIMessage } from "@/lib/chat-types";
import { cn } from "@/lib/utils";

function messageText(message: OreBaseUIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export function ChatClient({
  chatId,
  initialMessages,
  initialInput = "",
}: {
  chatId: string;
  initialMessages: OreBaseUIMessage[];
  initialInput?: string;
}) {
  const router = useRouter();
  const [input, setInput] = useState(initialInput);
  const listRef = useRef<HTMLDivElement>(null);
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ id, messages }) => ({
          body: { id, messages },
        }),
      }),
    [],
  );

  const { messages, sendMessage, status, error } = useChat<OreBaseUIMessage>({
    id: chatId,
    messages: initialMessages,
    transport,
    onFinish: () => {
      router.refresh();
    },
  });

  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  function submit() {
    const trimmed = input.trim();
    if (!trimmed || busy) return;
    setInput("");
    void sendMessage({ text: trimmed });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div ref={listRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
          {messages.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Ask a question about the filings in the database. Answers cite the
              source document and page.
            </div>
          ) : null}

          {messages.map((message) => {
            const text = messageText(message);
            const citations =
              message.metadata?.citations ??
              (message.role === "assistant" ? collectCitations([message]) : []);
            return (
              <div
                key={message.id}
                className={cn(
                  "flex flex-col gap-2",
                  message.role === "user" ? "items-end" : "items-start",
                )}
              >
                {text ? (
                  <div
                    className={cn(
                      "max-w-[85%] whitespace-pre-wrap rounded-lg px-4 py-2 text-sm",
                      message.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground",
                    )}
                  >
                    {text}
                  </div>
                ) : null}
                {message.role === "assistant" ? (
                  <CitationChips citations={citations} />
                ) : null}
              </div>
            );
          })}

          {busy ? (
            <div className="text-sm text-muted-foreground">Searching filings…</div>
          ) : null}

          {error ? (
            <div className="text-sm text-destructive">
              Something went wrong. Please try again.
            </div>
          ) : null}
        </div>
      </div>

      <div className="border-t p-4">
        <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about a project, resource estimate, or drill result…"
            rows={2}
            className="resize-none"
            disabled={busy}
          />
          <Button onClick={submit} disabled={busy || !input.trim()}>
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
