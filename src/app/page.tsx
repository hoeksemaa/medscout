export const dynamic = "force-dynamic";

import countriesData from "@/data/countries.json";
import type { CountriesData } from "@/lib/types";
import { DrYellowPagesApp } from "@/components/dr-yellowpages-app";
import { NavHeader } from "@/components/nav-header";

export default function Home() {
  return (
    <main className="min-h-screen bg-background">
      <NavHeader />

      {/* Disclaimer banner */}
      <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-center text-xs text-amber-800">
        Results are AI-generated and should be independently verified before
        commercial use. Dr. YellowPages does not guarantee the accuracy, completeness,
        or currentness of any information displayed.
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Dr. YellowPages</h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Find physicians and surgeons who are actively using a specific
            medical device or performing a specific procedure. Powered by Claude
            Sonnet 4.6 and Brave Search.
          </p>
        </div>

        <DrYellowPagesApp countriesData={countriesData as CountriesData} />
      </div>
    </main>
  );
}
