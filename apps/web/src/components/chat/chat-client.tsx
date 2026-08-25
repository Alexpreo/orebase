"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { CitationChips } from "@/components/chat/citation-chips";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { collectCitations } from "@/lib/citations";
import type { ChatSearchFilters, OreBaseUIMessage } from "@/lib/chat-types";
import { cn } from "@/lib/utils";

const DOC_TYPES = [
  { value: "", label: "All types" },
  { value: "ni43101", label: "NI 43-101" },
  { value: "sk1300", label: "SK-1300" },
  { value: "pea", label: "PEA" },
  { value: "pfs", label: "PFS" },
  { value: "fs", label: "Feasibility" },
  { value: "press_release", label: "Press release" },
  { value: "mda", label: "MD&A" },
  { value: "financials", label: "Financials" },
];

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
  initialFilters = {},
}: {
  chatId: string;
  initialMessages: OreBaseUIMessage[];
  initialInput?: string;
  initialFilters?: ChatSearchFilters;
}) {
  const router = useRouter();
  const [input, setInput] = useState(initialInput);
  const [company, setCompany] = useState(initialFilters.company ?? "");
  const [docType, setDocType] = useState(initialFilters.docType ?? "");
  const [dateFrom, setDateFrom] = useState(initialFilters.dateFrom ?? "");
  const [dateTo, setDateTo] = useState(initialFilters.dateTo ?? "");
  const listRef = useRef<HTMLDivElement>(null);
  const filters = useMemo<ChatSearchFilters>(
    () => ({
      company: company.trim() || undefined,
      docType: docType.trim() || undefined,
      dateFrom: dateFrom.trim() || undefined,
      dateTo: dateTo.trim() || undefined,
    }),
    [company, docType, dateFrom, dateTo],
  );
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ id, messages }) => ({
          body: { id, messages, filters },
        }),
      }),
    [filters],
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
              source document and page. Use the filters below to scope retrieval.
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
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="h-8 w-44"
              value={company}
              onChange={(event) => setCompany(event.target.value)}
              placeholder="Company"
              aria-label="Filter by company"
              disabled={busy}
            />
            <select
              className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
              value={docType}
              onChange={(event) => setDocType(event.target.value)}
              aria-label="Filter by document type"
              disabled={busy}
            >
              {DOC_TYPES.map((row) => (
                <option key={row.value || "all"} value={row.value}>
                  {row.label}
                </option>
              ))}
            </select>
            <Input
              className="h-8 w-36"
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              aria-label="Filed from"
              disabled={busy}
            />
            <Input
              className="h-8 w-36"
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              aria-label="Filed to"
              disabled={busy}
            />
          </div>
          <div className="flex items-end gap-2">
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
    </div>
  );
}
