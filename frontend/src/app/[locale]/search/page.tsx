"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, RotateCcw } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useSearch } from "@/hooks/useSearch";

type Category = "all" | "players" | "tournaments" | "matches";
type Sort = "relevance" | "newest" | "oldest";
type Hit = { id: string; entity: string; title: string; description?: string; score: number };

const categories: Array<{ value: Category; label: string; entity?: string }> = [
  { value: "all", label: "All" },
  { value: "players", label: "Players", entity: "user" },
  { value: "tournaments", label: "Tournaments", entity: "tournament" },
  { value: "matches", label: "Matches", entity: "match" },
];

export default function SearchPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const initialQuery = params.get("q") ?? "";
  const initialCategory = (categories.some((item) => item.value === params.get("category"))
    ? params.get("category")
    : "all") as Category;
  const initialSort = (["relevance", "newest", "oldest"].includes(params.get("sort") ?? "")
    ? params.get("sort")
    : "relevance") as Sort;
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState<Category>(initialCategory);
  const [sort, setSort] = useState<Sort>(initialSort);

  const searchFn = useCallback(async (value: string, filters: { category: string; sort: Sort }) => {
    const result = await api.search(value, filters);
    return result.hits ?? [];
  }, []);
  const { results, isLoading, error, setQuery: setSearchQuery } = useSearch<Hit>(searchFn, {
    minSearchLength: 1,
    category,
    sort,
    cacheKey: "global-search",
  });

  useEffect(() => {
    setSearchQuery(query);
  }, [query, setSearchQuery]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (query.trim()) next.set("q", query.trim());
    if (category !== "all") next.set("category", category);
    if (sort !== "relevance") next.set("sort", sort);
    const suffix = next.toString();
    router.replace(suffix ? `${pathname}?${suffix}` : pathname, { scroll: false });
  }, [query, category, sort, pathname, router]);

  const reset = () => {
    setCategory("all");
    setSort("relevance");
    setQuery("");
  };

  const hasFilters = category !== "all" || sort !== "relevance";
  const countLabel = useMemo(() => results.length === 1 ? "1 result" : `${results.length} results`, [results.length]);

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">Search ArenaX</h1>
        <p className="text-muted-foreground">Find players, tournaments, and matches.</p>
      </header>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <Input aria-label="Search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search players, tournaments, matches..." className="pl-10" />
      </div>
      <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between" aria-label="Search filters">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
          {categories.map((item) => (
            <Button key={item.value} size="sm" variant={category === item.value ? "primary" : "outline"} aria-pressed={category === item.value} onClick={() => setCategory(item.value)}>
              {item.label}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <label htmlFor="search-sort" className="text-sm text-muted-foreground">Sort by</label>
          <select id="search-sort" value={sort} onChange={(event) => setSort(event.target.value as Sort)} className="h-10 rounded-md border border-border bg-background px-3 text-sm">
            <option value="relevance">Most Relevant</option>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
          </select>
          <Button size="sm" variant="ghost" onClick={reset} disabled={!hasFilters && !query}>
            <RotateCcw className="mr-2 h-4 w-4" /> Reset
          </Button>
        </div>
      </section>
      <section aria-live="polite" aria-busy={isLoading} className="space-y-3">
        <p className="text-sm text-muted-foreground">{countLabel}</p>
        {isLoading ? Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="animate-pulse rounded-lg border border-border p-5">
            <div className="mb-3 h-4 w-1/3 rounded bg-muted" />
            <div className="h-3 w-2/3 rounded bg-muted" />
          </div>
        )) : error ? (
          <p role="alert" className="rounded-lg border border-destructive/30 p-5 text-sm text-destructive">{error}</p>
        ) : !query.trim() ? (
          <p className="rounded-lg border border-border p-5 text-sm text-muted-foreground">Enter a search term to see results.</p>
        ) : results.length === 0 ? (
          <p className="rounded-lg border border-border p-5 text-sm text-muted-foreground">No results found. Try another search or reset your filters.</p>
        ) : results.map((hit) => (
          <article key={`${hit.entity}:${hit.id}`} className="rounded-lg border border-border p-5">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{hit.entity}</p>
            <h2 className="font-semibold">{hit.title}</h2>
            {hit.description && <p className="mt-1 text-sm text-muted-foreground">{hit.description}</p>}
          </article>
        ))}
      </section>
    </main>
  );
}
