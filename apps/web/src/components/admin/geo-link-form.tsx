"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function GeoLinkForm({ occurrenceId }: { occurrenceId: string }) {
  const router = useRouter();
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/geo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ occurrenceId, projectId: projectId.trim() }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(body?.error ?? "Could not link occurrence.");
        return;
      }
      setProjectId("");
      router.refresh();
    } catch {
      setError("Could not link occurrence.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        className="h-8 w-64"
        placeholder="Project UUID"
        value={projectId}
        onChange={(event) => setProjectId(event.target.value)}
      />
      <Button size="sm" disabled={busy || !projectId.trim()} onClick={() => void submit()}>
        Link coordinates
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
