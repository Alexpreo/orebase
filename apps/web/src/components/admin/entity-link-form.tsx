"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function EntityLinkForm({
  documentId,
  defaultCompany,
}: {
  documentId: string;
  defaultCompany?: string | null;
}) {
  const router = useRouter();
  const [companyName, setCompanyName] = useState(defaultCompany ?? "");
  const [projectName, setProjectName] = useState("");
  const [sedarProfile, setSedarProfile] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "link",
          documentId,
          companyName,
          projectName,
          sedarProfile: sedarProfile.trim() || undefined,
        }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(body?.error ?? "Could not link filing.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not link filing.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      <Input
        className="h-8 w-48"
        placeholder="Company"
        value={companyName}
        onChange={(event) => setCompanyName(event.target.value)}
      />
      <Input
        className="h-8 w-48"
        placeholder="Project"
        value={projectName}
        onChange={(event) => setProjectName(event.target.value)}
      />
      <Input
        className="h-8 w-36"
        placeholder="SEDAR profile"
        value={sedarProfile}
        onChange={(event) => setSedarProfile(event.target.value)}
      />
      <Button size="sm" disabled={busy || !companyName.trim() || !projectName.trim()} onClick={() => void submit()}>
        Link
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
