"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function WatchButton({
  projectId,
  companyId,
}: {
  projectId?: string;
  companyId?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/watchlists/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, companyId }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Could not add to watchlist.");
        return;
      }
      router.push("/watchlist");
      router.refresh();
    } catch {
      setError("Could not add to watchlist.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void add()}>
        Add to watchlist
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
