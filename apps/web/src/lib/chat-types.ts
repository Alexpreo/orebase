import type { UIMessage } from "ai";

export type Citation = {
  label: string;
  documentId: string;
  pageStart: number | null;
  pageEnd: number | null;
};

export type ChatMessageMetadata = {
  citations?: Citation[];
};

export type OreBaseUIMessage = UIMessage<ChatMessageMetadata>;

export type ChatSummary = {
  id: string;
  title: string | null;
  created_at: string | Date;
};

export type ChatSearchFilters = {
  company?: string;
  docType?: string;
  dateFrom?: string;
  dateTo?: string;
};
