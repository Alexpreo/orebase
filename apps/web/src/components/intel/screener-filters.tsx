"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SavedFilter } from "@/lib/intel-types";

const ALL = "all";

type Facets = {
  commodities: string[];
  countries: string[];
  stages: string[];
  studyTypes: string[];
};

export function ScreenerFilters({
  facets,
  saved,
}: {
  facets: Facets;
  saved: SavedFilter[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [saveName, setSaveName] = useState("");

  function apply(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (!value || value === ALL) next.delete(key);
    else next.set(key, value);
    const query = next.toString();
    startTransition(() => {
      router.replace(query ? `/screener?${query}` : "/screener");
    });
  }

  function loadSaved(criteria: SavedFilter["criteria"]) {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(criteria)) {
      if (value) next.set(key, String(value));
    }
    startTransition(() => {
      router.replace(next.toString() ? `/screener?${next}` : "/screener");
    });
  }

  async function save() {
    const name = saveName.trim();
    if (!name) return;
    const criteria = Object.fromEntries(searchParams.entries());
    await fetch("/api/screener/filters", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, criteria }),
    });
    setSaveName("");
    router.refresh();
  }

  async function removeSaved(id: string) {
    await fetch("/api/screener/filters", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    router.refresh();
  }

  const exportHref = `/api/screener/export?${searchParams.toString()}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2" data-pending={isPending ? "true" : "false"}>
        <select
          className="h-8 rounded-md border bg-background px-2 text-sm"
          value={searchParams.get("commodity") ?? ALL}
          onChange={(event) => apply("commodity", event.target.value)}
        >
          <option value={ALL}>All commodities</option>
          {facets.commodities.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <select
          className="h-8 rounded-md border bg-background px-2 text-sm"
          value={searchParams.get("country") ?? ALL}
          onChange={(event) => apply("country", event.target.value)}
        >
          <option value={ALL}>All countries</option>
          {facets.countries.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <select
          className="h-8 rounded-md border bg-background px-2 text-sm"
          value={searchParams.get("stage") ?? ALL}
          onChange={(event) => apply("stage", event.target.value)}
        >
          <option value={ALL}>All stages</option>
          {facets.stages.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <select
          className="h-8 rounded-md border bg-background px-2 text-sm"
          value={searchParams.get("studyType") ?? ALL}
          onChange={(event) => apply("studyType", event.target.value)}
        >
          <option value={ALL}>All studies</option>
          {facets.studyTypes.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <Input
          className="h-8 w-36"
          placeholder="Grade key (Cu_pct)"
          defaultValue={searchParams.get("minGradeKey") ?? ""}
          onBlur={(event) => apply("minGradeKey", event.target.value)}
        />
        <Input
          className="h-8 w-24"
          placeholder="Min grade"
          defaultValue={searchParams.get("minGrade") ?? ""}
          onBlur={(event) => apply("minGrade", event.target.value)}
        />
        <Input
          className="h-8 w-36"
          type="date"
          defaultValue={searchParams.get("filedSince") ?? ""}
          onChange={(event) => apply("filedSince", event.target.value)}
        />
        <Button size="sm" variant="outline" nativeButton={false} render={<a href={exportHref} />}>
          Export CSV
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="h-8 w-48"
          placeholder="Save filter set name"
          value={saveName}
          onChange={(event) => setSaveName(event.target.value)}
        />
        <Button size="sm" variant="secondary" onClick={() => void save()}>
          Save filters
        </Button>
        {saved.map((item) => (
          <span key={item.id} className="flex items-center gap-1 text-xs">
            <Button size="xs" variant="outline" onClick={() => loadSaved(item.criteria)}>
              {item.name}
            </Button>
            <Button size="xs" variant="ghost" onClick={() => void removeSaved(item.id)}>
              ×
            </Button>
          </span>
        ))}
      </div>
    </div>
  );
}
