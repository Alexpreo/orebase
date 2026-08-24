"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function ExtractButton({
  documentId,
  projectId,
}: {
  documentId?: string;
  projectId?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function enqueue() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentId, projectId }),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        queued?: number;
      } | null;
      if (!response.ok) {
        setMessage(body?.error ?? "Could not enqueue extract.");
        return;
      }
      setMessage(`${body?.queued ?? 0} extract job(s) queued.`);
      router.refresh();
    } catch {
      setMessage("Could not enqueue extract.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void enqueue()}>
        Extract
      </Button>
      {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
    </div>
  );
}
