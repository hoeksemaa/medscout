import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { NavHeader } from "@/components/nav-header";
import { ResultsTable } from "@/components/results-table";
import type { SearchResponse, Candidate } from "@/lib/types";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function SearchDetailPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: search } = await supabase
    .from("searches")
    .select(`
      id,
      procedure,
      geography,
      result_count,
      results_json,
      search_count_discovery,
      search_count_filtering,
      search_count_research,
      status,
      error_message,
      started_at,
      unlocks(id)
    `)
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!search) redirect("/history");

  const isUnlocked = Array.isArray(search.unlocks) && search.unlocks.length > 0;
  const candidates = (search.results_json as Candidate[]) ?? [];
  const accepted = candidates.filter((c) => c.status === "accepted");
  const rejected = candidates.filter((c) => c.status === "rejected");

  const responseData: SearchResponse = {
    candidates,
    metadata: {
      procedure: search.procedure,
      geography: search.geography,
      searchCountDiscovery: search.search_count_discovery ?? 0,
      searchCountFiltering: search.search_count_filtering ?? 0,
      searchCountResearch: search.search_count_research ?? 0,
      timestamp: search.started_at,
    },
  };

  return (
    <main className="min-h-screen bg-background">
      <NavHeader />

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">
            {search.procedure}
          </h1>
          <p className="text-sm text-muted-foreground">
            {search.geography ?? "Worldwide"} &middot;{" "}
            {new Date(search.started_at).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
            {" "}&middot; {accepted.length} accepted, {rejected.length} rejected
          </p>
        </div>

        {search.status === "failed" ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <strong>This search encountered an error:</strong> {search.error_message}
          </div>
        ) : (
          <ResultsTable
            data={responseData}
            searchId={search.id}
            unlocked={isUnlocked}
          />
        )}
      </div>
    </main>
  );
}
