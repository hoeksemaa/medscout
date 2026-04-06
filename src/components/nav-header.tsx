"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { History, LogOut } from "lucide-react";

export function NavHeader() {
  const router = useRouter();
  const supabase = createClient();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  return (
    <header className="border-b bg-background px-4 py-2 flex items-center justify-between">
      <Link href="/" className="font-semibold text-sm">
        MedScout
      </Link>
      <div className="flex items-center gap-2">
        <Link
          href="/history"
          className="inline-flex items-center gap-1 rounded-lg px-2.5 h-7 text-sm font-medium hover:bg-muted transition-colors"
        >
          <History className="h-4 w-4" />
          History
        </Link>
        <Button variant="ghost" size="sm" onClick={handleLogout}>
          <LogOut className="h-4 w-4 mr-1" />
          Log out
        </Button>
      </div>
    </header>
  );
}
