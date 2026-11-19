"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, getToolName } from "ai";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PdfViewer } from "@/components/documents/pdf-viewer";
import { parseAnswer, type Inline } from "@/lib/answer-blocks";
import { citationLabel, collectCitations, INLINE_CITATION_RE } from "@/lib/citations";
import type { ChatSearchFilters, Citation, OreBaseUIMessage } from "@/lib/chat-types";
import type { DocumentMeta } from "@/lib/documents";
import { cn, formatShortDate, SOURCE_LABEL } from "@/lib/utils";

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

const GHOST =
  "inline-flex h-[34px] items-center rounded-[9px] border border-line-2 bg-transparent px-3 text-xs font-medium text-fg-2 transition-colors duration-(--duration-instant) hover:bg-raised hover:text-fg";

function messageText(message: OreBaseUIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function messageCitations(message: OreBaseUIMessage): Citation[] {
  return message.metadata?.citations ?? (message.role === "assistant" ? collectCitations([message]) : []);
}

/** Split answer text on inline [uuid p.N] tags. */
function splitInline(text: string): (string | { label: string; citation: Citation })[] {
  const out: (string | { label: string; citation: Citation })[] = [];
  let last = 0;
  for (const m of text.matchAll(new RegExp(INLINE_CITATION_RE.source, "gi"))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const pageStart = Number.parseInt(m[2], 10);
    const pageEnd = m[3] ? Number.parseInt(m[3], 10) : pageStart;
    const citation = { documentId: m[1], pageStart, pageEnd, label: citationLabel(m[1], pageStart, pageEnd) };
    out.push({ label: citation.label, citation });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Step = { name: string; detail: string; result: string | null };

/** Tool calls from the live stream. Saved messages keep only text, so they have none. */
function messageSteps(message: OreBaseUIMessage): Step[] {
  return message.parts.filter(isToolUIPart).map((part) => {
    const input = part.input && typeof part.input === "object" ? (part.input as Record<string, unknown>) : {};
    const detail = Object.entries(input)
      .filter(([, v]) => v != null && v !== "")
      .map(([k, v]) => `${k}=${typeof v === "string" ? JSON.stringify(v) : String(v)}`)
      .join(", ");
    let result: string | null = null;
    if (part.state === "output-available" && part.output && typeof part.output === "object") {
      const o = part.output as Record<string, unknown>;
      if (typeof o.error === "string") result = o.error;
      else if (Array.isArray(o.chunks)) result = `${o.chunks.length} passages`;
      else if (Array.isArray(o.rows)) result = `${o.rows.length} rows`;
    } else if (part.state === "output-error") {
      result = "failed";
    }
    return { name: getToolName(part), detail, result };
  });
}

export function ChatClient({
  chatId,
  initialMessages,
  initialInput = "",
  initialFilters = {},
  initialSource = null,
  docMeta = {},
  documentCount = null,
}: {
  chatId: string;
  initialMessages: OreBaseUIMessage[];
  initialInput?: string;
  initialFilters?: ChatSearchFilters;
  initialSource?: number | null;
  docMeta?: Record<string, DocumentMeta>;
  documentCount?: number | null;
}) {
  const router = useRouter();
  const [input, setInput] = useState(initialInput);
  const [company, setCompany] = useState(initialFilters.company ?? "");
  const [docType, setDocType] = useState(initialFilters.docType ?? "");
  const [dateFrom, setDateFrom] = useState(initialFilters.dateFrom ?? "");
  const [dateTo, setDateTo] = useState(initialFilters.dateTo ?? "");
  const [scopeOpen, setScopeOpen] = useState(false);
  const [source, setSource] = useState<number | null>(initialSource);
  const [copied, setCopied] = useState<string | null>(null);
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
      // Refreshes the sidebar's recent chats and the cited documents' metadata.
      router.refresh();
    },
  });

  const busy = status === "submitted" || status === "streaming";

  // Thread-wide numbering: the first time a source is cited it gets the next number.
  const { sources, numberOf } = useMemo(() => {
    const list: Citation[] = [];
    const index = new Map<string, number>();
    const add = (c: Citation) => {
      if (index.has(c.label)) return;
      list.push(c);
      index.set(c.label, list.length);
    };
    for (const m of messages) {
      if (m.role !== "assistant") continue;
      for (const piece of splitInline(messageText(m))) if (typeof piece !== "string") add(piece.citation);
      for (const c of messageCitations(m)) add(c);
    }
    return { sources: list, numberOf: index };
  }, [messages]);

  const active = source != null ? sources[source - 1] ?? null : null;
  const activeMeta = active ? docMeta[active.documentId] : undefined;

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  function openSource(n: number | null) {
    setSource(n);
    // Keep the open source in the URL so the view can be shared, without a server round trip.
    const url = new URL(window.location.href);
    if (n == null) url.searchParams.delete("src");
    else url.searchParams.set("src", String(n));
    window.history.replaceState(null, "", url);
  }

  function submit(event?: React.FormEvent) {
    event?.preventDefault();
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

  async function copyAnswer(message: OreBaseUIMessage) {
    const plain = splitInline(messageText(message))
      .map((p) => (typeof p === "string" ? p : `[${numberOf.get(p.label)}]`))
      .join("");
    try {
      await navigator.clipboard.writeText(plain);
      setCopied(message.id);
    } catch {
      setCopied(null);
    }
  }

  function chip(label: string): ReactNode {
    const n = numberOf.get(label);
    if (!n) return null;
    return (
      <button
        type="button"
        onClick={() => openSource(n)}
        aria-label={`Open source ${n}`}
        aria-pressed={source === n}
        className={cn(
          "num mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-md px-[5px] align-[1px] text-[11px] font-semibold transition-colors duration-(--duration-instant)",
          source === n ? "bg-copper text-on-copper" : "bg-copper-tint text-copper-2 hover:bg-copper hover:text-on-copper",
        )}
      >
        {n}
      </button>
    );
  }

  // Inline runs keep [uuid p.N] tags; swap them for numbered chips here.
  function renderInline(runs: Inline[]): ReactNode {
    return runs.map((run, i) => {
      const body = splitInline(run.text).map((p, j) =>
        typeof p === "string" ? <Fragment key={j}>{p}</Fragment> : <Fragment key={j}>{chip(p.label)}</Fragment>,
      );
      return run.bold ? (
        <strong key={i} className="font-semibold text-white">
          {body}
        </strong>
      ) : (
        <Fragment key={i}>{body}</Fragment>
      );
    });
  }

  function renderAnswer(text: string): ReactNode {
    const prose = "text-[15px] leading-[1.7] text-fg-1";
    return parseAnswer(text).map((b, i) => {
      if (b.kind === "h") {
        return (
          <h3 key={i} className="font-heading text-base font-semibold text-fg">
            {renderInline(b.text)}
          </h3>
        );
      }
      if (b.kind === "ul" || b.kind === "ol") {
        const List = b.kind;
        return (
          <List key={i} className={cn(prose, "flex flex-col gap-1 pl-5", b.kind === "ul" ? "list-disc" : "list-decimal")}>
            {b.items.map((item, j) => (
              <li key={j}>{renderInline(item)}</li>
            ))}
          </List>
        );
      }
      if (b.kind === "table") {
        const numeric = (cell: Inline[]) => /^[\s\d.,%$–—-]+$/.test(cell.map((c) => c.text).join(""));
        return (
          <div key={i} className="overflow-x-auto rounded-xl border border-line bg-panel">
            <table className="w-full min-w-[480px] border-collapse text-[13px]">
              <thead>
                <tr className="text-[11px] tracking-[0.06em] text-fg-4 uppercase">
                  {b.head.map((h, j) => (
                    <th key={j} scope="col" className={cn("px-3.5 py-2.5 font-semibold", j === 0 ? "text-left" : "text-right")}>
                      {renderInline(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((row, j) => (
                  <tr key={j} className="border-t border-line-soft transition-colors hover:bg-hover">
                    {row.map((cell, k) => (
                      <td
                        key={k}
                        className={cn("px-3.5 py-3", k === 0 ? "text-left" : "text-right", k > 0 && numeric(cell) && "num")}
                      >
                        {renderInline(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      return (
        <p key={i} className={prose}>
          {(b.kind === "p" ? b.lines : []).map((line, j) => (
            <Fragment key={j}>
              {j > 0 ? <br /> : null}
              {renderInline(line)}
            </Fragment>
          ))}
        </p>
      );
    });
  }

  const firstUser = messages.find((m) => m.role === "user");
  const title = firstUser ? messageText(firstUser).slice(0, 90) : "New chat";
  const scopes = [
    filters.company && { key: "company", label: `Company: ${filters.company}`, clear: () => setCompany("") },
    filters.docType && {
      key: "docType",
      label: DOC_TYPES.find((d) => d.value === filters.docType)?.label ?? filters.docType,
      clear: () => setDocType(""),
    },
    filters.dateFrom && { key: "from", label: `Filed since ${formatShortDate(filters.dateFrom)}`, clear: () => setDateFrom("") },
    filters.dateTo && { key: "to", label: `Filed before ${formatShortDate(filters.dateTo)}`, clear: () => setDateTo("") },
  ].filter(Boolean) as { key: string; label: string; clear: () => void }[];

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-[clamp(16px,3vw,36px)] py-[18px]">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="truncate font-heading text-xl font-semibold">{title}</h1>
          <span className="text-xs text-fg-4">
            {documentCount != null ? (
              <>
                Searching <span className="num">{documentCount.toLocaleString("en-US")}</span> documents ·{" "}
              </>
            ) : null}
            {sources.length} {sources.length === 1 ? "source" : "sources"} cited in this thread
          </span>
        </div>
        <Link href="/chat" className={cn(GHOST, "h-9 text-[13px]")}>
          New chat
        </Link>
      </header>

      <div className="flex min-h-0 flex-1">
        <section aria-label="Conversation" className="flex min-w-0 flex-[3_1_520px] flex-col">
          <div ref={listRef} className="flex-1 overflow-y-auto">
            <div className="flex flex-col gap-[22px] px-[clamp(16px,3vw,40px)] pt-7 pb-6">
              {messages.length === 0 ? (
                <div className="rise flex max-w-xl flex-col gap-2 rounded-2xl border border-line bg-panel p-5 text-sm text-fg-3">
                  <span className="font-heading text-lg font-semibold text-fg">Ask about the filings</span>
                  Answers come only from documents in the database, and every claim links to the page it came from.
                  Narrow the search with “+ Scope” below.
                </div>
              ) : null}

              {messages.map((message) => {
                const text = messageText(message);
                if (message.role === "user") {
                  return (
                    <div
                      key={message.id}
                      className="rise max-w-[560px] self-end rounded-[14px_14px_4px_14px] border border-line-2 bg-raised px-4 py-3.5 text-[15px] leading-[1.55] whitespace-pre-wrap"
                    >
                      {text}
                    </div>
                  );
                }
                const steps = messageSteps(message);
                const ownCitations = messageCitations(message);
                const inlineLabels = new Set(splitInline(text).flatMap((p) => (typeof p === "string" ? [] : [p.label])));
                const extra = ownCitations.filter((c) => !inlineLabels.has(c.label));
                return (
                  <div key={message.id} className="flex max-w-[820px] gap-3.5">
                    <div className="grid size-8 flex-none place-items-center rounded-[9px] border border-[#3A2A1C] bg-copper-wash">
                      <svg width="18" height="18" viewBox="0 0 28 28" aria-hidden="true">
                        <path d="M14 2 25 8.5v11L14 26 3 19.5v-11z" fill="none" stroke="#E0985A" strokeWidth="2" />
                        <circle cx="14" cy="11" r="3" fill="#E0985A" />
                      </svg>
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-3.5">
                      {steps.length > 0 ? (
                        <details className="rise d1 rounded-[10px] border border-track bg-well px-3.5 py-2.5">
                          <summary className="flex flex-wrap items-center gap-2.5 text-xs text-fg-3">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6FD3A0" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                              <path d="M5 12l5 5 9-10" />
                            </svg>
                            <span>
                              Ran <span className="num text-fg">{steps.length}</span> {steps.length === 1 ? "step" : "steps"}
                            </span>
                            {steps.map((s, i) => (
                              <Fragment key={i}>
                                <span className="text-[#3A424D]">·</span>
                                <span className="num text-fg">{s.name}</span>
                                {s.result ? <span>{s.result}</span> : null}
                              </Fragment>
                            ))}
                            <span className="ml-auto text-fg-4">Show steps</span>
                          </summary>
                          <ol className="num mt-2.5 mb-0.5 list-decimal pl-[18px] text-xs leading-[1.8] break-words text-fg-3">
                            {steps.map((s, i) => (
                              <li key={i}>
                                {s.name}({s.detail}){s.result ? ` → ${s.result}` : ""}
                              </li>
                            ))}
                          </ol>
                        </details>
                      ) : null}

                      {text ? <div className="rise d2 flex flex-col gap-3.5">{renderAnswer(text)}</div> : null}
                      {!text && steps.length > 0 && !(busy && message.id === messages[messages.length - 1]?.id) ? (
                        <p role="status" className="text-[15px] leading-[1.7] text-fg-3">
                          Stopped after {steps.length} research steps without writing an answer. Try a narrower
                          question, or name the project or company.
                        </p>
                      ) : null}

                      {extra.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1 text-xs text-fg-4">
                          Also searched {extra.map((c) => <Fragment key={c.label}>{chip(c.label)}</Fragment>)}
                        </div>
                      ) : null}

                      {text && !(busy && message.id === messages[messages.length - 1]?.id) ? (
                        <div className="rise d3 flex flex-wrap gap-2">
                          <button type="button" className={GHOST} onClick={() => copyAnswer(message)}>
                            {copied === message.id ? "Copied" : "Copy answer"}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}

              {status === "submitted" ? (
                <div className="flex max-w-[820px] flex-col gap-2 pl-[46px]" role="status">
                  <span className="text-xs text-fg-3">Searching filings…</span>
                  <div className="shimmer h-3.5 w-full rounded" />
                  <div className="shimmer h-3.5 w-[70%] rounded" />
                </div>
              ) : null}

              {error ? (
                <div role="alert" className="text-sm text-bad">
                  Something went wrong. Please try again.
                </div>
              ) : null}
            </div>
          </div>

          <form
            onSubmit={submit}
            className="mx-[clamp(16px,3vw,40px)] mb-6 flex flex-col gap-2.5 rounded-2xl border border-line-3 bg-panel p-3 shadow-composer"
          >
            <label htmlFor="chat-input" className="sr-only">
              Message
            </label>
            <textarea
              id="chat-input"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={messages.length ? "Ask a follow-up…" : "Ask about a project, resource estimate, or drill result…"}
              rows={2}
              disabled={busy}
              className="resize-none border-0 bg-transparent px-1.5 py-1 text-[15px] text-fg outline-none placeholder:text-fg-4 focus-visible:outline-none"
            />
            {scopeOpen ? (
              <fieldset className="flex flex-wrap items-center gap-2 border-t border-line-soft pt-2.5">
                <legend className="sr-only">Search scope</legend>
                <input
                  className="h-8 w-44 rounded-lg border border-line-3 bg-nav px-2.5 text-[13px] text-fg placeholder:text-fg-4"
                  value={company}
                  onChange={(event) => setCompany(event.target.value)}
                  placeholder="Company"
                  aria-label="Filter by company"
                  disabled={busy}
                />
                <select
                  className="h-8 rounded-lg border border-line-3 bg-nav px-2 text-[13px] text-fg"
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
                <input
                  className="h-8 w-36 rounded-lg border border-line-3 bg-nav px-2 text-[13px] text-fg"
                  type="date"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                  aria-label="Filed from"
                  disabled={busy}
                />
                <input
                  className="h-8 w-36 rounded-lg border border-line-3 bg-nav px-2 text-[13px] text-fg"
                  type="date"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                  aria-label="Filed to"
                  disabled={busy}
                />
              </fieldset>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              {scopes.map((s) => (
                <span
                  key={s.key}
                  className="inline-flex h-7 items-center gap-1.5 rounded-full bg-copper-wash pr-1 pl-2.5 text-xs text-copper-2"
                >
                  {s.label}
                  <button
                    type="button"
                    onClick={s.clear}
                    aria-label={`Remove ${s.label}`}
                    className="grid size-5 place-items-center rounded-full hover:bg-copper-tint"
                  >
                    ×
                  </button>
                </span>
              ))}
              <button
                type="button"
                onClick={() => setScopeOpen((v) => !v)}
                aria-expanded={scopeOpen}
                className="h-7 rounded-full border border-dashed border-line-3 px-2.5 text-xs font-medium text-fg-3 hover:bg-raised hover:text-fg"
              >
                {scopeOpen ? "Done" : "+ Scope"}
              </button>
              <button
                type="submit"
                aria-label="Send"
                disabled={busy || !input.trim()}
                className="ml-auto grid size-10 place-items-center rounded-[11px] bg-copper text-on-copper transition-colors hover:bg-copper-hover disabled:opacity-50"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </svg>
              </button>
            </div>
          </form>
        </section>

        <aside
          aria-label="Source viewer"
          className={cn(
            "min-w-0 flex-col gap-3.5 overflow-y-auto bg-nav p-5",
            // Desktop: a fixed column. Narrower: slides over the thread when a source is open.
            "lg:static lg:flex lg:flex-[2_1_400px] lg:border-l lg:border-line-soft",
            active ? "panel-slide fixed inset-0 z-50 flex lg:animate-none" : "hidden",
          )}
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1.5 text-[11px] font-semibold tracking-[0.08em] text-fg-4 uppercase">Sources</span>
            {sources.map((c, i) => (
              <button
                key={c.label}
                type="button"
                onClick={() => openSource(i + 1)}
                aria-pressed={source === i + 1}
                aria-label={`Source ${i + 1}`}
                className={cn(
                  "num h-[30px] min-w-[30px] rounded-lg px-1.5 text-xs font-semibold transition-colors",
                  source === i + 1
                    ? "bg-copper text-on-copper"
                    : "border border-line-2 text-fg-2 hover:bg-raised hover:text-fg",
                )}
              >
                {i + 1}
              </button>
            ))}
            {active ? (
              <button
                type="button"
                onClick={() => openSource(null)}
                aria-label="Close source viewer"
                className="ml-auto grid size-9 place-items-center rounded-lg text-fg-3 hover:bg-raised hover:text-fg lg:hidden"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            ) : null}
          </div>

          {active ? (
            <>
              <div className="flex flex-col gap-1">
                <Link href={`/documents/${active.documentId}`} className="text-[15px] font-semibold text-fg hover:text-copper-2">
                  {activeMeta?.title ?? `Document ${active.documentId.slice(0, 8)}`}
                </Link>
                {activeMeta ? (
                  <span className="text-xs text-fg-3">
                    {[
                      activeMeta.company_name,
                      SOURCE_LABEL[activeMeta.source ?? ""] ?? activeMeta.source,
                      activeMeta.filed_at ? `filed ${formatShortDate(activeMeta.filed_at)}` : null,
                      activeMeta.page_count ? `${activeMeta.page_count} pages` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                ) : null}
              </div>
              <PdfViewer
                key={`${active.documentId}:${active.pageStart ?? 1}`}
                fileUrl={`/api/documents/${active.documentId}/file`}
                initialPage={active.pageStart ?? 1}
                initialScale={0.75}
                className="min-h-[420px] flex-1"
              />
              <div className="flex items-center justify-between text-xs text-fg-3">
                <span key={active.label} className="flash rounded px-1.5 py-0.5">
                  Cited page{" "}
                  <span className="num text-fg">
                    {active.pageStart ?? "—"}
                    {active.pageEnd && active.pageEnd !== active.pageStart ? `–${active.pageEnd}` : ""}
                  </span>
                  {activeMeta?.page_count ? (
                    <>
                      {" "}
                      of <span className="num">{activeMeta.page_count}</span>
                    </>
                  ) : null}
                </span>
                <Link
                  href={`/documents/${active.documentId}?page=${active.pageStart ?? 1}`}
                  className="text-copper hover:text-copper-2"
                >
                  Open full report →
                </Link>
              </div>
            </>
          ) : (
            <p className="text-[13px] text-fg-3">
              {sources.length > 0
                ? "Pick a numbered citation to open the page it came from."
                : "Cited pages open here, next to the answer."}
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
