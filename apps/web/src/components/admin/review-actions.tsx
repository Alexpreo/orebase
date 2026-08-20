"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ReviewItem } from "@/lib/intel-types";

export function ReviewActions({ item }: { item: ReviewItem }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [json, setJson] = useState(() => JSON.stringify(item.payload, null, 2));

  async function submit(action: "approve" | "reject" | "edit") {
    setBusy(true);
    setError(null);
    let fields: Record<string, unknown> | undefined;
    if (action === "edit") {
      try {
        fields = JSON.parse(json) as Record<string, unknown>;
      } catch {
        setBusy(false);
        setError("Edit payload is not valid JSON.");
        return;
      }
    }
    try {
      const response = await fetch("/api/admin/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: item.kind, id: item.id, action, fields }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Review action failed.");
        return;
      }
      setEditing(false);
      router.refresh();
    } catch {
      setError("Review action failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => void submit("approve")}>
          Approve
        </Button>
        <Button
          size="sm"
          variant="destructive"
          disabled={busy}
          onClick={() => void submit("reject")}
        >
          Reject
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => setEditing((value) => !value)}
        >
          {editing ? "Cancel edit" : "Edit"}
        </Button>
      </div>
      {editing ? (
        <div className="flex flex-col gap-2">
          <Textarea
            value={json}
            onChange={(event) => setJson(event.target.value)}
            rows={10}
            className="font-mono text-xs"
          />
          <Button size="sm" disabled={busy} onClick={() => void submit("edit")}>
            Save edits
          </Button>
        </div>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

export function ReviewQueueToolbar({
  minConfidence,
  remaining,
}: {
  minConfidence: number;
  remaining: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approved, setApproved] = useState<number | null>(null);

  async function approveConfident() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "approve_confident", min_confidence: minConfidence }),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        approved?: number;
      } | null;
      if (!response.ok) {
        setError(body?.error ?? "Could not approve confident rows.");
        return;
      }
      setApproved(body?.approved ?? 0);
      router.refresh();
    } catch {
      setError("Could not approve confident rows.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="outline"
        disabled={busy || remaining === 0}
        onClick={() => void approveConfident()}
      >
        Approve remaining ≥ {minConfidence.toFixed(2)}
      </Button>
      {approved != null ? (
        <p className="text-xs text-muted-foreground">{approved} row(s) approved.</p>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
