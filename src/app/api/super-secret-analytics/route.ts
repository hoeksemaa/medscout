import { createServiceClient } from "@/lib/supabase/service";

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export async function GET() {
  const supabase = createServiceClient();

  const { data: searches, error } = await supabase
    .from("searches")
    .select("*")
    .order("started_at", { ascending: false });

  if (error) {
    return new Response(`<h1>Error</h1><pre>${esc(error.message)}</pre>`, {
      status: 500,
      headers: { "Content-Type": "text/html" },
    });
  }

  // Resolve user emails
  const userIds = [...new Set(searches.map((s: any) => s.user_id))];
  const emailMap: Record<string, string> = {};
  for (const uid of userIds) {
    const {
      data: { user },
    } = await supabase.auth.admin.getUserById(uid as string);
    if (user) emailMap[user.id] = user.email ?? "unknown";
  }

  // Build HTML table rows
  const tableRows = searches
    .map((s: any) => {
      const email = emailMap[s.user_id] ?? "unknown";
      const duration = s.duration_total_s
        ? `${Number(s.duration_total_s).toFixed(1)}s`
        : "—";
      const statusColor =
        s.status === "completed"
          ? "#22c55e"
          : s.status === "failed"
            ? "#ef4444"
            : "#eab308";

      return `<tr>
        <td>${esc(fmtDate(s.started_at))}</td>
        <td>${esc(email)}</td>
        <td>${esc(s.procedure)}</td>
        <td>${esc(s.geography ?? "—")}</td>
        <td><span style="color:${statusColor};font-weight:600">${esc(s.status)}</span></td>
        <td>${s.result_count} / ${s.requested_count}</td>
        <td>${duration}</td>
        <td>${s.tokens_in ?? "—"}</td>
        <td>${s.tokens_out ?? "—"}</td>
        <td>${s.search_count_discovery ?? 0} + ${s.search_count_vetting ?? 0}</td>
        <td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.error_message ?? "")}</td>
      </tr>`;
    })
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>MedScout Analytics</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #0a0a0a; color: #e5e5e5; padding: 2rem; }
    h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
    .subtitle { color: #737373; margin-bottom: 1.5rem; font-size: 0.875rem; }
    table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
    th { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 2px solid #262626; color: #a3a3a3; font-weight: 500; white-space: nowrap; }
    td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #1a1a1a; white-space: nowrap; }
    tr:hover td { background: #141414; }
    .wrap { overflow-x: auto; }
  </style>
</head>
<body>
  <h1>MedScout Analytics</h1>
  <p class="subtitle">${searches.length} searches total</p>
  <div class="wrap">
    <table>
      <thead>
        <tr>
          <th>Time</th>
          <th>User</th>
          <th>Procedure</th>
          <th>Geography</th>
          <th>Status</th>
          <th>Results</th>
          <th>Duration</th>
          <th>Tokens In</th>
          <th>Tokens Out</th>
          <th>Searches (D+V)</th>
          <th>Error</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
  </div>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html" },
  });
}
