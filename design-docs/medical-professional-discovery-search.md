# Dr. YellowPages: Medical Professional Discovery Search

---

# Files

```
dr-yellowpages/
├── package.json                          — Dependencies and build scripts (Next.js 16, React 19, Anthropic SDK, Supabase, Stripe, Tailwind 4, shadcn/ui)
├── tsconfig.json                         — TypeScript config: strict mode, @/* path alias to ./src/*, ES2017 target
├── next.config.ts                        — Next.js configuration (currently minimal/empty)
├── components.json                       — shadcn/ui config: base-nova style, Tailwind CSS, lucide icons, component path aliases
├── eslint.config.mjs                     — ESLint extending Next.js core web vitals and TypeScript rules
├── postcss.config.mjs                    — PostCSS config using the Tailwind CSS plugin
├── .env.example                          — Env var template: Supabase, Anthropic, Brave Search, Stripe keys, app URL
├── next-env.d.ts                         — Auto-generated Next.js type definitions
│
├── supabase/
│   └── migrations/
│       └── 001_schema.sql                — Creates profiles, searches, and unlocks tables with RLS policies
│
├── public/
│   ├── file.svg                          — Default Next.js SVG assets (unused by app)
│   ├── globe.svg
│   ├── next.svg
│   ├── vercel.svg
│   └── window.svg
│
└── src/
    ├── proxy.ts                          — Next.js middleware entry point: calls updateSession, runs on all routes except static assets and webhooks
    │
    ├── data/
    │   └── countries.json                — 6 regions + 195+ countries with ISO alpha-3 codes. Shape: { regions: Record<key, {name, description}>, countries: [{alpha3, name, region}] }
    │
    ├── lib/
    │   ├── types.ts                      — TypeScript interfaces: Candidate, SearchRequest, SearchResponse, WebSearchResult, Region, Country, CountriesData, SSEEvent
    │   ├── constants.ts                  — App-wide variables: unlock price, visible free result count, candidate pool cap, accepted results cap, minimum password length
    │   ├── prompts.ts                    — LLM system prompt, discovery/scoring message builders, web_search tool definition
    │   ├── use-search.ts                 — Client hook: search state machine (idle/searching/results/error), SSE stream parser, CSV export
    │   ├── web-search.ts                 — Web search provider: calls configured search API, returns normalized WebSearchResult[]; also formatSearchResults for LLM
    │   ├── countries.ts                  — Geography utilities: getRegions, getCountries, getCountriesByRegion, formatGeography
    │   ├── stripe.ts                     — Stripe client singleton, lazily initialized from env secret key
    │   ├── utils.ts                      — cn() function combining clsx + tailwind-merge for conditional CSS classes
    │   └── supabase/
    │       ├── client.ts                 — Browser-side Supabase client factory (public URL + anon key)
    │       ├── server.ts                 — Server-side Supabase client factory with cookie-based session management
    │       ├── service.ts                — Service-role Supabase client for DB writes that bypass RLS
    │       └── proxy.ts                  — Auth middleware: refreshes sessions, redirects unauthed→/login, authed→away from auth pages
    │
    ├── components/
    │   ├── dr-yellowpages-app.tsx              — Client root: orchestrates search state, conditionally renders SearchForm/SearchProgress/ResultsTable/error
    │   ├── nav-header.tsx                — Header bar: Dr. YellowPages branding, user email, History link, logout button
    │   ├── search-form.tsx               — Search input: procedure name, region/country filter
    │   ├── search-progress.tsx           — Progress display: current phase, progress bar, status messages during search
    │   ├── results-table.tsx             — Results: accepted candidate cards, collapsed rejected section, confidence badges, CSV download, unlock overlay
    │   └── ui/                           — shadcn/ui primitives (copied in, not npm deps)
    │       ├── badge.tsx
    │       ├── button.tsx
    │       ├── card.tsx
    │       ├── input.tsx
    │       ├── label.tsx
    │       ├── progress.tsx
    │       ├── select.tsx
    │       ├── separator.tsx
    │       └── table.tsx
    │
    └── app/
        ├── layout.tsx                    — Root layout: HTML metadata, Geist fonts, html/body wrapper
        ├── page.tsx                      — Home page: disclaimer banner, app header, DrYellowPagesApp with countries data
        ├── globals.css                   — Tailwind imports, shadcn theme variables for light/dark modes
        ├── favicon.ico                   — Favicon
        ├── (auth)/
        │   ├── auth-form.tsx             — Reusable login/signup form: email/password fields, server action submission, mode toggle
        │   ├── login/
        │   │   ├── page.tsx              — Login page: AuthForm in Suspense with login server action
        │   │   └── actions.ts            — Server action: authenticates via Supabase signInWithPassword, redirects
        │   └── signup/
        │       ├── page.tsx              — Signup page: AuthForm in Suspense with signup server action
        │       └── actions.ts            — Server action: validates password length, creates account via Supabase signUp, redirects
        ├── history/
        │   ├── page.tsx                  — Search history list: user's searches with status badges (running/locked/unlocked/error)
        │   └── [id]/
        │       └── page.tsx              — Search detail: full results for a specific search, candidate cards, unlock CTA
        └── api/
            ├── search/
            │   └── route.ts              — POST: three-phase search pipeline (discovery/vetting/scoring), SSE streaming, stores in Supabase. Max 300s
            ├── billing/
            │   └── checkout/
            │       └── route.ts          — POST: creates Stripe checkout session for unlock, validates ownership, prevents duplicates
            ├── webhooks/
            │   └── stripe/
            │       └── route.ts          — POST: validates Stripe webhook signature, processes checkout.session.completed, inserts unlock record
            └── super-secret-analytics/
                └── route.ts              — GET: server-rendered HTML analytics dashboard of all searches across all users (service role only)
```

---

# What to Build

## Purpose

Dr. YellowPages helps medical device companies find physicians and surgeons who are actively using a specific device or performing a specific procedure. A sales rep types in a procedure name, optionally narrows by geography, and receives a vetted list of practitioners with source citations, profile links, and a confidence score.

The core value proposition: if a company already knows 10 names and we surface 20, and 3 of the new names turn into productive conversations, that's a win.

## User Flow

1. Sign up or log in (email + password)
2. Enter procedure or device name (free text, required)
3. Optionally select a geographic filter (region and/or country)
4. Click "Search"
5. Watch streaming progress ("Discovering... Vetting 7 of 20... Scoring...")
6. Receive results — a configurable number of top results are shown free, the rest are blurred behind a paywall
7. Pay to unlock the full result set for that search
8. Download as CSV
9. Revisit past searches via the History page

Single-shot interaction. Each query produces one response. No multi-turn chat.

## Inputs

### Procedure / Device Name
Free text. The LLM interprets this and expands to relevant synonyms and abbreviations (e.g., "PTCS" for percutaneous transhepatic cholangioscopy). Examples:
- "HoLEP"
- "percutaneous cholangioscopy"
- "SpyGlass Discover"
- "da Vinci robotic prostatectomy"

### Geographic Filter
Two levels, both optional:

1. **Region** — single-select dropdown. Six regions: North America, Latin America & Caribbean, Europe, Middle East & North Africa, Sub-Saharan Africa, Asia-Pacific.
2. **Country** — multi-select, filtered by region if one is selected. Full list from `countries.json`.

If no geography is specified, search is worldwide (results will naturally skew toward countries with strong publication cultures). The LLM should note this bias.

## Outputs

Results are displayed as cards. For each result, the visual hierarchy is:

1. **Name** (with credentials) — most prominent
2. **Notes** — concise 1–3 sentence summary of why this person is relevant
3. **All other fields** — institution, city, evidence, source, etc.

### Output Schema

| Field | Required | Description |
|---|---|---|
| Rank | Yes | 1–N, ordered by confidence descending |
| Name | Yes | Full name with credentials (e.g., "Amy E. Krambeck, MD") |
| Notes | Yes | 1–3 sentences: why this person matters for this query |
| Institution | Yes | Current hospital or practice |
| City | Yes | City, State/Country |
| Specialty | Yes | e.g., "Urology", "Interventional Radiology" |
| Evidence | Yes | How they're connected to the procedure/device |
| Source | Yes | Verifiable source — PubMed ID, journal, hospital website, conference proceedings. "Unverified" if uncertain |
| Profile Link | Preferred | Institutional profile URL. Blank if not found — never fabricated |
| Confidence | Yes | 1–100 score per the rubric below |
| Status | Yes | "accepted" or "rejected" with rejection reason |

### What We Do NOT Output
- Phone numbers, personal email addresses, home addresses
- Anything not publicly available through institutional/professional channels

### Honesty Policy
Every field follows a strict honesty protocol:
- If a field cannot be confirmed, display "Unknown" or "Unverified"
- Never fabricate a URL, publication, or credential
- If credentials are uncertain, say "Credentials unconfirmed"
- Messy truth > clean fiction, always

## Confidence Scoring Rubric

Score is 1–100 based on additive/subtractive factors.

### Base Score (0–50): Strength of Association

- **40–50**: Lead/corresponding author on published study, or named as performing the procedure in institutional materials
- **25–39**: Co-author on relevant study, or listed in a department that performs the procedure
- **10–24**: Mentioned in conference proceedings, or works at a known center but no direct evidence of personal involvement
- **1–9**: Tangential connection only (same department, different subspecialty)

### Modifiers

| Factor | Adjustment |
|---|---|
| Confirmed MD/DO/MBBS/equivalent | +15 |
| Credentials unconfirmed | +0 |
| Non-physician (PhD, NP, PA) | -10 (still include, but note) |
| Activity in last 2 years | +15 |
| Activity in last 3–5 years | +10 |
| No evidence of recent activity | -10 |
| Institutional profile page found and verified | +10 |
| Obituary or retirement notice found | -100 (exclude entirely) |
| Self-reported case volume >100 | +5 |
| KOL signals (conference faculty, training program leader, guideline author) | +5 |

Maximum: 100. Minimum to include: 20.

## Search Pipeline

### Phase 1: Discovery
The LLM runs 8–12 web searches to build a candidate pool of up to `MAX_CANDIDATES_TO_CONSIDER` (currently 200). Searches target PubMed, hospital sites, professional directories, conference proceedings, specialty journals, Doximity, LinkedIn, YouTube.

The LLM is given a single tool — `web_search(query: string)` — which wraps the search provider. The LLM calls this tool in an agentic loop (it keeps calling until it stops or hits 12 calls). When the loop ends, the LLM returns candidates as a JSON array wrapped in `<candidates>` tags.

Discovery candidate shape (pre-scoring):
```json
{
  "name": "Amy E. Krambeck, MD",
  "notes": "High-volume HoLEP surgeon and fellowship director.",
  "institution": "Northwestern Memorial Hospital",
  "city": "Chicago, IL",
  "specialty": "Urology",
  "evidence": "Lead author on 5 published case series",
  "source": "PubMed PMID 39197701",
  "profileLink": "https://..." or null,
  "confidence": 85
}
```

### Phase 2: Vetting
For each candidate, the server calls the search API directly (not through the LLM — saves tokens and is faster):

Query: `"{Name}" "{Institution}" {procedure}`

This surfaces whether they exist at that institution, whether they're associated with the procedure, whether any obituary or retirement notice appears, and their institutional profile URL.

### Phase 3: Scoring
The LLM receives the raw candidates plus their vetting search results. It assigns confidence scores per the rubric, writes Notes, marks the top `MAX_ACCEPTED_RESULTS` (currently 100) as accepted and the rest as rejected with reasons, and drops anyone below the confidence threshold. The LLM returns scored candidates as a JSON array wrapped in `<results>` tags. Each candidate now includes `rank`, `status` ("accepted" | "rejected"), and optionally `rejectionReason`.

After the LLM returns, the server deterministically sorts all candidates by confidence descending and reassigns rank 1–N. The LLM's ordering is not trusted — sorting is mechanically enforced.

### Progress UX
During all phases, the server streams SSE events to the client. The frontend displays the current phase, a progress counter during vetting ("Vetting 7 of 20..."), and status messages. Once scoring completes, the full results table appears.

### SSE Event Protocol

The search endpoint streams newline-delimited `data:` events. Each event is a JSON object with a `type` discriminator:

```typescript
// Progress updates during each phase
{ type: "progress", phase: "discovery" | "vetting" | "scoring", message: string, current?: number, total?: number }

// Final results payload (includes searchId for unlock/history linking)
{ type: "result", data: SearchResponse, searchId?: string | null }

// Error (search still terminates with "done" after this)
{ type: "error", message: string }

// Terminal event — always sent last
{ type: "done" }
```

`current` and `total` are only populated during the vetting phase. The `result` event carries the full `SearchResponse` (candidates array + metadata). Errors are non-recoverable — the client transitions to the error state.

## Monetization

A configurable number of top results are shown free. The remaining results are blurred. Users pay a configurable price per search to unlock the full result set. Payment is handled via a redirect-based checkout flow. The exact number of free results and the price are variables that may change — they are defined in `src/lib/constants.ts`, not hardcoded throughout the app.

## Authentication

Email and password signup/login via Supabase Auth. Minimum password length is configurable (currently 16 characters). A middleware proxy enforces authentication on all routes except static assets and webhook endpoints. Unauthenticated users are redirected to /login with their intended destination preserved. Authenticated users are redirected away from auth pages.

## Search History

Users can view all of their past searches on the History page. Each search shows procedure, geography, result count, date, and status (running/completed/failed, locked/unlocked). Clicking into a search shows the full results.

## Analytics

An internal analytics endpoint renders a server-side HTML dashboard of all searches across all users. It shows timing, token usage, search counts, status, and errors. Accessible via service role — not linked in the main UI.

## Disclaimer

The app displays a persistent banner:

> Results are AI-generated and should be independently verified before commercial use. Dr. YellowPages does not guarantee the accuracy, completeness, or currentness of any information displayed.

## Success Criteria

A query is successful if:
1. Every name is a real person (zero fabrications)
2. Every source citation is verifiable
3. At least 80% of accepted results have a confidence score >= 40
4. Results include names a knowledgeable insider would recognize, plus at least a few they wouldn't
5. Query completes within a reasonable time frame

---

# How to Build It

## Philosophy

Use the simplest and fastest tool that meets the objective. Every technology choice below was made on that basis.

## Provider Agnosticism

The LLM provider and web search provider are not baked into the project's identity. The architecture should allow these to be swapped. File names, interfaces, and abstractions should be provider-agnostic (e.g., `web-search.ts`, not `brave-search.ts`). The current providers are Anthropic (Claude) and Brave Search, but these are implementation details, not architectural commitments.

## Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Language | TypeScript | Type safety, good DX with Next.js |
| Framework | Next.js 16 (App Router) | API routes built in, SSE support, server actions for auth |
| Package Manager | Bun | Fast installs, fast dev server |
| Styling | Tailwind CSS v4 | Utility-first, fast iteration |
| Components | shadcn/ui | Tailwind-native, copied into project (not an npm dependency) |
| Auth & Database | Supabase | Auth, PostgreSQL, RLS, real-time — single service for all persistence needs |
| Payments | Stripe | Checkout sessions + webhooks for pay-per-unlock |
| LLM | Claude (via @anthropic-ai/sdk) | Currently Sonnet; user-swappable in principle |
| Web Search | Brave Search API | Simple single-key setup, 2,000 free queries/month |
| Deployment | Local (`bun dev`) or Vercel | Local has no timeout limits; Vercel Pro needed for >60s routes |

## Database Schema

Three tables, all with row-level security:

**profiles** — linked to `auth.users`. Stores `stripe_customer_id`.

**searches** — append-only. Each row is one search run. Stores:
- Request params: procedure, geography, requested_count (stores MAX_ACCEPTED_RESULTS at time of search)
- Results: status (running/completed/failed), result_count, results_json (JSONB), error_message
- Provider tracking: search_engine, llm_model
- Usage: search_count_discovery, search_count_vetting, tokens_in, tokens_out
- Timing: started_at, duration_total_s, duration_discovery_s, duration_vetting_s, duration_scoring_s
- Audit: audit_log (JSONB array, see below)

RLS: users can view and insert their own searches.

**unlocks** — payment records. Links user + search + Stripe session ID + amount. Unique constraint on (user_id, search_id).

RLS: users can view their own unlocks; service role can insert.

### Audit Log Structure

Each search row contains an `audit_log` JSONB array. Each entry has the shape:

```json
{ "phase": "discovery" | "vetting" | "scoring", "event_type": string, "timestamp": ISO8601, "data": {} }
```

Event types by phase:
- **discovery**: `phase_start`, `llm_call` (data: tokens_in, tokens_out), `web_search` (data: query, result_count), `web_search_error` (data: query, error), `phase_end` (data: candidates_found)
- **vetting**: `phase_start` (data: candidates_to_vet), `web_search` (data: candidate, query, result_count), `web_search_error` (data: candidate, query, error), `phase_end`
- **scoring**: `phase_start` (data: candidates_to_score), `llm_call` (data: tokens_in, tokens_out), `phase_end` (data: accepted, rejected)

## API Route Design

### `POST /api/search`

Accepts procedure and geography. Streams SSE events (progress, result, error, done). Orchestrates the three-phase pipeline: discovery via LLM with tool use, vetting via direct search API calls, scoring via LLM. Pool size and accepted count are controlled by developer constants (`MAX_CANDIDATES_TO_CONSIDER`, `MAX_ACCEPTED_RESULTS`), not user input. Stores the search record and audit log in Supabase throughout.

### `POST /api/billing/checkout`

Creates a Stripe checkout session for a specific search. Validates ownership and prevents duplicate unlocks. Returns the checkout URL for client-side redirect.

### `POST /api/webhooks/stripe`

Receives Stripe webhook events. Validates signature. On `checkout.session.completed`, inserts an unlock record.

### `GET /api/super-secret-analytics`

Returns a server-rendered HTML analytics dashboard. Uses the service-role Supabase client to read all searches and resolve user emails.

## Frontend Architecture

The client is a single-page app within the Next.js App Router. The main search flow is managed by a `useSearch` React hook that handles SSE streaming and state transitions:

```
IDLE → SEARCHING → RESULTS
                 → ERROR
```

Search results are rendered as expandable cards. Accepted candidates are shown prominently; rejected candidates are collapsed. Results beyond the free count are blurred with an unlock overlay that triggers the Stripe checkout flow.

CSV export is client-side — the hook provides a `candidatesToCSV` utility.

## Auth Flow

Supabase Auth with email/password. Server actions handle login and signup. A Next.js middleware (`src/proxy.ts` → `src/lib/supabase/proxy.ts`) runs on every request to refresh sessions and enforce redirects. Webhook endpoints are excluded from auth middleware so Stripe can reach them.

## Environment Variables

All secrets are server-side env vars (never exposed to the client):
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase (public, safe for client)
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role (server only)
- `ANTHROPIC_API_KEY` — LLM provider key
- `BRAVE_SEARCH_API_KEY` — Search provider key
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` — Stripe
- `NEXT_PUBLIC_APP_URL` — App base URL for Stripe redirect callbacks

## Running Locally

```bash
bun install
bun dev    # http://localhost:3000
```

No timeout limits locally. Vercel Pro ($20/mo) is required for production deployment due to the 300s max duration on the search route.

## Cost Model

| Resource | Cost | Notes |
|---|---|---|
| Local hosting | Free | `bun dev` |
| LLM API | ~$0.02–0.10 per query | Depends on token count and provider |
| Search API | Free tier available | Brave: 2,000 queries/month free; ~25 searches per 20-result query |
| Supabase | Free tier | Sufficient for current scale |
| Stripe | 2.9% + $0.30 per transaction | Standard processing fees |
