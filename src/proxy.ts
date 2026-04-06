import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Match all routes except static files and API webhooks
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|api/webhooks).*)",
  ],
};
