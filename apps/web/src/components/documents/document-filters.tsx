"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DocumentFacets } from "@/lib/documents";

const ALL = "all";

// Long enough that typing a company name is a single navigation, short enough to feel live.
const SEARCH_DEBOUNCE_MS = 300;

type DocumentFiltersProps = {
  facets: DocumentFacets;
};

export function DocumentFilters({ facets }: DocumentFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const currentSearch = searchParams.get("search") ?? "";
  const [search, setSearch] = useState(currentSearch);
  const [syncedSearch, setSyncedSearch] = useState(currentSearch);

  // Keep the field in step when navigation changes the query string from elsewhere
  // (back button, cleared filters) without clobbering what is being typed. Adjusting
  // during render rather than in an effect avoids rendering a stale value first.
  if (currentSearch !== syncedSearch) {
    setSyncedSearch(currentSearch);
    setSearch(currentSearch);
  }

  const apply = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(searchParams.toString());
      if (!value || value === ALL) {
        next.delete(key);
      } else {
        next.set(key, value);
      }
      const query = next.toString();
      startTransition(() => {
        router.replace(query ? `/documents?${query}` : "/documents");
      });
    },
    [router, searchParams],
  );

  useEffect(() => {
    if (search === currentSearch) {
      return;
    }
    const timer = setTimeout(() => apply("search", search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [apply, currentSearch, search]);

  const hasFilters = Array.from(searchParams.keys()).length > 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-56 flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search titles…"
          className="pl-8"
          aria-label="Search document titles"
        />
      </div>

      <FacetSelect
        label="Type"
        value={searchParams.get("docType") ?? ALL}
        options={facets.docTypes}
        onChange={(value) => apply("docType", value)}
      />
      <FacetSelect
        label="Status"
        value={searchParams.get("status") ?? ALL}
        options={facets.statuses}
        onChange={(value) => apply("status", value)}
      />
      <FacetSelect
        label="Source"
        value={searchParams.get("source") ?? ALL}
        options={facets.sources}
        onChange={(value) => apply("source", value)}
      />

      {hasFilters ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => startTransition(() => router.replace("/documents"))}
        >
          <X className="size-4" />
          Clear
        </Button>
      ) : null}

      {isPending ? (
        <span className="text-xs text-muted-foreground">Updating…</span>
      ) : null}
    </div>
  );
}

type FacetSelectProps = {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
};

function FacetSelect({ label, value, options, onChange }: FacetSelectProps) {
  if (options.length === 0) {
    return null;
  }

  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={label}
      className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <option value={ALL}>{label}: all</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {label}: {option}
        </option>
      ))}
    </select>
  );
}
