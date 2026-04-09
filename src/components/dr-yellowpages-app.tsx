"use client";

import { useCallback } from "react";
import { SearchForm } from "@/components/search-form";
import { SearchProgress } from "@/components/search-progress";
import { ResultsTable } from "@/components/results-table";
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

  const isSearching = state.status === "searching";

  return (
    <div className="space-y-6">
      <SearchForm
        countriesData={countriesData}
        onSearch={handleSearch}
        disabled={isSearching}
      />

      {state.status === "searching" && (
        <SearchProgress
          phase={state.phase}
          message={state.message}
          names={state.names}
          current={state.current}
          total={state.total}
          onStop={stop}
        />
      )}

      {state.status === "results" && (
        <ResultsTable
          data={state.data}
          searchId={state.searchId}
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
