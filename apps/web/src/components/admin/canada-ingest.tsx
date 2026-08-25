"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const DOC_TYPES = [
  { value: "ni43101", label: "NI 43-101 technical report" },
  { value: "pea", label: "PEA" },
  { value: "pfs", label: "PFS" },
  { value: "fs", label: "Feasibility" },
  { value: "press_release", label: "News release" },
  { value: "mda", label: "MD&A / material change" },
];

export function CanadaIngestForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setOk(null);
    const form = event.currentTarget;
    try {
      const response = await fetch("/api/admin/ingest", {
        method: "POST",
        body: new FormData(form),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        document_id?: string;
        duplicate?: boolean;
      } | null;
      if (!response.ok) {
        setError(body?.error ?? "Upload failed.");
        return;
      }
      if (body?.duplicate) {
        setOk("Already in the corpus (same PDF hash).");
      } else {
        setOk(`Queued for parse. Document ${body?.document_id ?? ""}`);
        form.reset();
      }
      router.refresh();
    } catch {
      setError("Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Canada filing (NI 43-101)</CardTitle>
        <CardDescription>
          Download the PDF in Chrome from SEDAR+ or the issuer IR page, then
          drop it here. Automated search needs a headed profile and
          SEDAR_JSON_SEARCH_URL — status is on this page. Hosted Vercel uploads
          are size-capped; for a full 43-101 use{" "}
          <code className="text-xs">
            uv run python -m sedar.ingest_local --file report.pdf
          </code>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-3" onSubmit={(event) => void onSubmit(event)}>
          <label className="flex flex-col gap-1 text-sm">
            PDF
            <Input name="file" type="file" accept="application/pdf,.pdf" required />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Issuer
            <Input name="issuer" placeholder="e.g. Foran Mining" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Title
            <Input name="title" placeholder="McIlvenna Bay 43-101" />
          </label>
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Type
              <select
                name="doc_type"
                defaultValue="ni43101"
                className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
              >
                {DOC_TYPES.map((row) => (
                  <option key={row.value} value={row.value}>
                    {row.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Filed
              <Input name="filed_at" type="date" />
            </label>
          </div>
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? "Uploading…" : "Ingest Canadian filing"}
          </Button>
          {ok ? <p className="text-xs text-muted-foreground">{ok}</p> : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </form>
      </CardContent>
    </Card>
  );
}
