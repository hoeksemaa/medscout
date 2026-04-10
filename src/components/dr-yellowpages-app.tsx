"use client";

import { useCallback } from "react";
import { SearchForm } from "@/components/search-form";
import { LiveLeaderboard } from "@/components/live-leaderboard";
import { useSearch } from "@/lib/use-search";
import type { CountriesData } from "@/lib/types";

interface DrYellowPagesAppProps {
  countriesData: CountriesData;
}

export function DrYellowPagesApp({ countriesData }: DrYellowPagesAppProps) {
  const { state, search, stop } = useSearch();

  const handleSearch = useCallback(
    (params: {
      procedure: string;
      region?: string;
      countries?: string[];
    }) => {
      search({
        ...params,
        region: params.region === "worldwide" ? undefined : params.region,
      });
    },
    [search],
  );

  const isSearching = state.status === "live";

  return (
    <div className="space-y-6">
      <SearchForm
        countriesData={countriesData}
        onSearch={handleSearch}
        disabled={isSearching}
      />

      {state.status === "live" && (
        <LiveLeaderboard
          live={state.live}
          onStop={stop}
        />
      )}

      {state.status === "error" && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <strong>Error:</strong> {state.message}
        </div>
      )}
    </div>
  );
}
