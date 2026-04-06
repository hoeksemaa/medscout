"use client";

import { useState, useCallback } from "react";
import { ApiKeyForm } from "@/components/api-key-form";
import { SearchForm } from "@/components/search-form";
import { SearchProgress } from "@/components/search-progress";
import { ResultsTable } from "@/components/results-table";
import { useSearch } from "@/lib/use-search";
import type { CountriesData } from "@/lib/types";

interface MedScoutAppProps {
  countriesData: CountriesData;
}

export function MedScoutApp({ countriesData }: MedScoutAppProps) {
  const [keys, setKeys] = useState<{
    anthropicKey: string;
    braveSearchKey: string;
  } | null>(null);

  const { state, search } = useSearch();

  const handleKeysSet = useCallback(
    (k: { anthropicKey: string; braveSearchKey: string }) => {
      setKeys(k);
    },
    []
  );

  const handleSearch = useCallback(
    (params: {
      procedure: string;
      region?: string;
      countries?: string[];
      resultCount: number;
    }) => {
      if (!keys) return;
      search({
        ...keys,
        ...params,
        region: params.region === "worldwide" ? undefined : params.region,
      });
    },
    [keys, search]
  );

  const keysConfigured = keys !== null;
  const isSearching = state.status === "searching";

  return (
    <div className="space-y-6">
      <ApiKeyForm onKeysSet={handleKeysSet} />

      {keysConfigured && (
        <SearchForm
          countriesData={countriesData}
          onSearch={handleSearch}
          disabled={isSearching}
        />
      )}

      {state.status === "searching" && (
        <SearchProgress
          phase={state.phase}
          message={state.message}
          current={state.current}
          total={state.total}
        />
      )}

      {state.status === "results" && <ResultsTable data={state.data} />}

      {state.status === "error" && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <strong>Error:</strong> {state.message}
        </div>
      )}
    </div>
  );
}
