"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Citation, ChatResponse } from "@/lib/chat-types";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  isError?: boolean;
};

function makeId() {
  return Math.random().toString(36).slice(2);
}

export function ChatClient() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  function scrollToBottom() {
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  async function sendMessage() {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    const userMessage: ChatMessage = {
      id: makeId(),
      role: "user",
      content: trimmed,
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);
    scrollToBottom();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });
      const data = (await res.json()) as ChatResponse;

      if (!res.ok || "error" in data) {
        const errorText =
          "error" in data ? data.error : "Something went wrong.";
        setMessages((prev) => [
          ...prev,
          { id: makeId(), role: "assistant", content: errorText, isError: true },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: makeId(),
            role: "assistant",
            content: data.answer,
            citations: data.citations,
          },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: makeId(),
          role: "assistant",
          content: "Network error. Please try again.",
          isError: true,
        },
      ]);
    } finally {
      setIsLoading(false);
      scrollToBottom();
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
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

          {messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                "flex flex-col gap-2",
                message.role === "user" ? "items-end" : "items-start",
              )}
            >
              <div
                className={cn(
                  "max-w-[85%] whitespace-pre-wrap rounded-lg px-4 py-2 text-sm",
                  message.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : message.isError
                      ? "bg-destructive/10 text-destructive"
                      : "bg-muted text-foreground",
                )}
              >
                {message.content}
              </div>

              {message.citations && message.citations.length > 0 ? (
                <div className="flex max-w-[85%] flex-wrap gap-1.5">
                  {message.citations.map((citation) => (
                    <Badge
                      key={`${message.id}-${citation.label}`}
                      variant="secondary"
                      className="cursor-default font-mono text-xs"
                      title={`Document ${citation.documentId}`}
                    >
                      {citation.label}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
          ))}

          {isLoading ? (
            <div className="text-sm text-muted-foreground">Searching filings…</div>
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
            disabled={isLoading}
          />
          <Button onClick={() => void sendMessage()} disabled={isLoading || !input.trim()}>
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
