import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { NavHeader } from "@/components/nav-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function HistoryPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: searches } = await supabase
    .from("searches")
    .select(`
      id,
      procedure,
      geography,
      result_count,
      status,
      error_message,
      started_at,
      unlocks(id)
    `)
    .eq("user_id", user.id)
    .order("started_at", { ascending: false });

  return (
    <main className="min-h-screen bg-background">
      <NavHeader />

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Search History</h1>
          <p className="text-sm text-muted-foreground">
            Your past searches and their results.
          </p>
        </div>

        {!searches || searches.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No searches yet. Go run your first search!
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {searches.map((s) => {
              const isUnlocked = Array.isArray(s.unlocks) && s.unlocks.length > 0;
              const hasError = s.status === "failed";
              const isRunning = s.status === "running";

              return (
                <Link key={s.id} href={`/history/${s.id}`}>
                  <Card className="hover:bg-muted/30 transition-colors cursor-pointer">
                    <CardContent className="py-4 flex items-center justify-between">
                      <div className="space-y-1">
                        <div className="font-medium">{s.procedure}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-3">
                          {s.geography && <span>{s.geography}</span>}
                          <span>{s.result_count} results</span>
                          <span>
                            {new Date(s.started_at).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                          </span>
                        </div>
                      </div>
                      <div>
                        {hasError ? (
                          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                            Error
                          </Badge>
                        ) : isRunning ? (
                          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                            Running
                          </Badge>
                        ) : isUnlocked ? (
                          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                            Unlocked
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                            Locked
                          </Badge>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
