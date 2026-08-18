export type Citation = {
  label: string; // e.g. "[a1b2c3 p.14]"
  documentId: string;
  pageStart: number | null;
  pageEnd: number | null;
};

export type ChatSuccess = {
  answer: string;
  citations: Citation[];
};

export type ChatError = {
  error: string;
};

export type ChatResponse = ChatSuccess | ChatError;
