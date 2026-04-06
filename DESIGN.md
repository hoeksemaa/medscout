# MedScout: Medical Professional Discovery Platform

---

# Part 1: What We're Building

## Purpose

MedScout helps medical device companies find physicians and surgeons who are
actively using a specific device or performing a specific procedure. A sales rep
types in a procedure name, optionally narrows by geography, and receives a
vetted list of practitioners with source citations, profile links, and a
confidence score.

The core value proposition: if a company already knows 10 names and we surface
20, and 3 of the new names turn into productive conversations, that's a win.

---

## User Flow

```
1. Land on page
2. Enter Anthropic API key and Brave Search API key
   (stored in browser sessionStorage only — never persisted server-side)
3. Fill in:
   - Procedure or device name (free text, required)
   - Geographic filter (optional — region dropdown and/or country multi-select)
   - Number of results (slider or input, default 20, range 5–50)
4. Click "Search"
5. See a progress counter ("Vetting 7 of 20...") while the model
   searches and vets candidates
6. Receive a results table, ranked by confidence
7. Download as CSV
```

Single-shot interaction. No multi-turn chat in V1. The UI container is
chat-shaped to make adding follow-up natural in V2, but for now each query
produces one response.

---

## Inputs

### Procedure / Device Name
Free text field. Examples:
- "HoLEP"
- "percutaneous cholangioscopy"
- "SpyGlass Discover"
- "da Vinci robotic prostatectomy"

The model will interpret this and expand to relevant synonyms/abbreviations
(e.g., "PTCS" for percutaneous transhepatic cholangioscopy).

### Geographic Filter
Two levels, both optional:

1. **Region** — dropdown, single-select. Options derived from `countries.json`:
   - North America
   - Latin America & Caribbean
   - Europe
   - Middle East & North Africa
   - Sub-Saharan Africa
   - Asia-Pacific
   - *(blank = worldwide)*

2. **Country** — multi-select, filtered by region if a region is selected.
   Full list of 249 countries from `countries.json`.

If no geography is specified, search is worldwide (but results will naturally
skew toward countries with strong publication cultures — US, UK, EU, Japan,
South Korea, etc.). The model should note this bias in its output.

### Number of Results
Default: 20. Range: 5–50. Each result gets an individual verification search,
so higher counts = longer wait times and more search API usage. UI should
display an estimate: "~2 min for 20 results."

---

## Outputs

Results are displayed as a list/table. For each result, the visual hierarchy is:

1. **Name** (with credentials) — most prominent
2. **Notes** — immediately below the name, second thing the eye lands on.
   A concise 1-3 sentence summary of why this person is relevant and what
   makes them notable. This is the human-readable "why you should care" field.
3. **All other fields** — institution, city, evidence, source, etc.

### Full Output Schema

| Column | Required | Description |
|---|---|---|
| **Rank** | Yes | 1–N, ordered by confidence score descending |
| **Name** | Yes | Full name with credentials (e.g., "Amy E. Krambeck, MD") |
| **Notes** | Yes | 1-3 sentence summary: why this person matters for this query. Highlights key facts like case volume, KOL status, training program leadership, or unique expertise. This is the field that helps a sales rep decide who to prioritize. |
| **Institution** | Yes | Current hospital or practice name |
| **City** | Yes | City, State/Country |
| **Specialty** | Yes | e.g., "Interventional Radiology", "Urology" |
| **Evidence** | Yes | Brief description of how they're connected to the procedure/device (e.g., "Lead author on 2024 JVIR multicenter study; 754 HoLEP cases in 2024") |
| **Source** | Yes | Where we found this information. Must be a real, verifiable source. Acceptable: PubMed ID, journal name + year, hospital website, Doximity, conference proceedings. If uncertain, say "Unverified" |
| **Profile Link** | Preferred | URL to their physician profile page (hospital/institutional). If not found, leave blank — do not fabricate URLs |
| **Confidence** | Yes | 1–100 score (see scoring rubric below) |

### What We Do NOT Output
- Phone numbers
- Personal email addresses
- Home addresses
- Anything not publicly available through institutional/professional channels

### Honesty Policy
Every field follows a strict honesty protocol:
- If a field cannot be confirmed, display "Unknown" or "Unverified"
- Never fabricate a URL, publication, or credential
- If the model is unsure whether someone holds an MD, say "Credentials unconfirmed"
- Messy truth > clean fiction, always

---

## Confidence Scoring Rubric

Score is 1–100 based on additive/subtractive factors:

### Base Score (0–50): Strength of Association with Procedure/Device
- **40–50**: Lead/corresponding author on published study, or named as performing
  the procedure in institutional materials
- **25–39**: Co-author on relevant study, or listed in a department that performs
  the procedure
- **10–24**: Mentioned in conference proceedings, or works at a known center but
  no direct evidence of personal involvement
- **1–9**: Tangential connection only (e.g., same department, different subspecialty)

### Modifiers

| Factor | Adjustment |
|---|---|
| Confirmed MD/DO/MBBS/equivalent | +15 |
| Credentials unconfirmed | +0 |
| Non-physician (PhD, NP, PA) | -10 (still include, but note) |
| Evidence of activity in last 2 years | +15 |
| Evidence of activity in last 3–5 years | +10 |
| No evidence of recent activity | -10 |
| Institutional profile page found and verified | +10 |
| Obituary or retirement notice found | -100 (exclude from results entirely) |
| Self-reported case volume >100 | +5 |
| KOL signals (conference faculty, training program leader, guideline author) | +5 |

Maximum possible: 100. Minimum to include in results: 20.

---

## Vetting Process

Two phases:

### Phase 1: Discovery
The model runs 3-5 web searches to build an initial candidate pool of 2-3x the
requested result count. Searches target PubMed, hospital sites, professional
directories, conference proceedings, and specialty journals.

### Phase 2: Verification
For each candidate, one dedicated verification search is run:

**Search query**: `"{Name}" "{Institution}" {procedure/device}`

This single search should surface:
1. Whether they exist at that institution (name + institution match)
2. Whether they're associated with the procedure (procedure appears in results)
3. Whether any obituary or retirement notice appears
4. Their institutional profile page URL (often in top results)

If the verification search contradicts the initial finding (wrong institution,
no procedure association, deceased), the candidate is either corrected,
downweighted, or dropped.

### Progress UX
During Phase 2, the frontend displays a progress counter:
"Vetting 7 of 20..." with a spinner. This ticks up as each candidate is
verified. Once all candidates are vetted, ranked, and filtered, the full
results table appears.

---

## Geography Data

Regions and countries sourced from `countries.json` in this repo. Six regions:

| Key | Name | Notes |
|---|---|---|
| `north_america` | North America | US + Canada. FDA zone. |
| `latin_america` | Latin America & Caribbean | Brazil, Mexico first. |
| `europe` | Europe | CE-mark / UKCA zone. |
| `mena` | Middle East & North Africa | Gulf states, Levant, North Africa. |
| `sub_saharan_africa` | Sub-Saharan Africa | Fragmented regulatory. |
| `asia_pacific` | Asia-Pacific | PMDA, NMPA, TGA zones. |

249 countries total, each tagged with a region.

---

## Disclaimer

The app displays a persistent banner:

> Results are AI-generated and should be independently verified before
> commercial use. MedScout does not guarantee the accuracy, completeness,
> or currentness of any information displayed.

---

## Success Criteria

A query is successful if:
1. Every name in the results is a real person (zero fabricated names)
2. Every source citation is verifiable (zero fabricated URLs/PMIDs)
3. At least 80% of results have a confidence score >= 40
4. The results include names that a knowledgeable industry insider would
   recognize, plus at least a few they wouldn't — that's the value add
5. Query completes in under 5 minutes for 20 results

---

## V2 Features (Explicitly Not In V1)

- Multi-turn follow-up ("tell me more about #14", "filter to East Coast only")
- Session persistence / saved searches
- User accounts and authentication
- Rate limiting and usage tracking
- Batch mode (upload a list of procedures, get results for all)
- CRM integration (push results to Salesforce/HubSpot)
- Alerts ("notify me when new publications appear for this procedure")
- Side-by-side comparison of two procedure landscapes
- Market size / adoption trend data alongside the practitioner list

---

## Naming

Working name: **MedScout**. Open to change.

---
---

# Part 2: How We're Building It

## Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| **Language** | TypeScript | Type safety, better DX with Next.js |
| **Framework** | Next.js 16 (App Router) | API routes built in, SSE support |
| **Package Manager** | Bun | Fast installs, fast dev server |
| **Styling** | Tailwind CSS v4 | Utility-first, fast iteration |
| **Component Library** | shadcn/ui | Tailwind-native, copy-paste components (cards, inputs, dropdowns, progress bars, badges). Not an npm dependency — components are copied into the project and owned by us. |
| **Deployment** | Local (`bun dev`) for V1 | No timeout limits. Vercel deploy possible later (Pro plan needed for >60s routes). |
| **LLM** | Claude Sonnet 4.6 via Anthropic API | User provides their own API key |
| **Web Search** | Brave Search API | User provides their own API key. Single key, no engine ID needed. 2,000 free queries/month. |
| **Geography Data** | `countries.json` (static, bundled in `src/data/`) | Copied from parent repo |

## Repository Structure

```
stage-zero/
├── agent.py                    # Existing
├── countries.json              # Existing
├── medscout/                   # MedScout app
│   ├── DESIGN.md               # This file
│   ├── package.json
│   ├── bun.lock
│   ├── tsconfig.json
│   ├── next.config.ts
│   ├── components.json          # shadcn/ui config
│   ├── src/
│   │   ├── data/
│   │   │   └── countries.json   # Bundled copy of geography data
│   │   ├── app/
│   │   │   ├── layout.tsx       # Root layout, fonts, metadata
│   │   │   ├── page.tsx         # Main page (server component, loads countries)
│   │   │   ├── globals.css      # Tailwind imports
│   │   │   └── api/
│   │   │       └── search/
│   │   │           └── route.ts # POST endpoint — orchestrates Claude + Brave
│   │   ├── components/
│   │   │   ├── ui/              # shadcn/ui primitives
│   │   │   ├── medscout-app.tsx # Client root — state machine (idle/searching/results/error)
│   │   │   ├── search-form.tsx  # Procedure input, region dropdown, result count slider
│   │   │   ├── api-key-form.tsx # Anthropic key + Brave Search key inputs
│   │   │   ├── results-table.tsx# Card-based results with expandable details + CSV download
│   │   │   └── search-progress.tsx # "Vetting 7 of 20..." counter with spinner
│   │   └── lib/
│   │       ├── google-search.ts # Brave Search API client (filename kept for git history)
│   │       ├── prompts.ts       # System prompt + tool definitions for Claude
│   │       ├── types.ts         # TypeScript interfaces
│   │       ├── countries.ts     # Geography data helpers
│   │       ├── use-search.ts    # React hook for SSE-based search state + CSV export
│   │       └── utils.ts         # shadcn/ui utility (cn)
│   └── ...
```

## API Route Design

### `POST /api/search`

**Request body:**
```typescript
{
  anthropicKey: string;
  braveSearchKey: string;
  procedure: string;
  region?: string;         // e.g., "north_america"
  countries?: string[];    // e.g., ["USA", "CAN"]
  resultCount: number;     // 5–50, default 20
}
```

**Response:** Server-Sent Events (SSE) stream. SSE pushes progress updates
to the frontend in real time; final results are batched at the end.

```typescript
// Progress events
data: { "type": "progress", "phase": "discovery", "message": "Search 3: \"HoLEP surgeon publications 2024\"" }
data: { "type": "progress", "phase": "vetting", "message": "Vetting Amy E. Krambeck...", "current": 7, "total": 20 }
data: { "type": "progress", "phase": "scoring", "message": "Scoring and ranking candidates..." }

// Final result
data: { "type": "result", "data": { "candidates": [...], "metadata": {...} } }

// Done
data: { "type": "done" }
```

### Orchestration Logic (inside the API route)

The API route orchestrates a 3-phase pipeline:

```
1. DISCOVERY PHASE
   - Send Claude a system prompt with the scoring rubric, honesty policy,
     and geographic constraints
   - Give Claude a `web_search` tool (wraps Brave Search API)
   - User message: "Find {resultCount * 2} medical professionals who
     perform {procedure} in {geography}."
   - Claude makes 3-5 tool calls to web_search, building a candidate list
   - Agentic loop continues until Claude stops calling tools
   - Claude returns a JSON array of raw candidates

2. VETTING PHASE
   - For each candidate, the API route calls Brave Search directly
     (NOT through Claude — saves tokens and is faster):
     Query: "{name}" "{institution}" {procedure}
   - Raw search results are stored per-candidate
   - Send progress SSE event after each candidate is vetted

3. SCORING PHASE
   - Send Claude the raw candidates + their verification search results
   - System prompt includes the scoring rubric
   - Claude assigns confidence scores, writes Notes, and ranks the list
   - Claude drops candidates below threshold (confidence < 20)
   - Claude returns final structured JSON

4. RESPONSE
   - Send the final ranked list as an SSE result event
   - Send done event
```

This hybrid approach (Claude for reasoning, direct API calls for mechanical
searches) keeps costs down and latency manageable.

## Brave Search Setup

The user needs one value: a **Brave Search API key**.

1. Go to https://brave.com/search/api/
2. Sign up / log in
3. Subscribe to the Free plan (2,000 queries/month)
4. Copy your API key
5. Enter it in MedScout's API Keys form

That's it. No search engine ID, no Google Cloud project, no extra configuration.

## Claude System Prompt (Summary)

The full prompt lives in `src/lib/prompts.ts`. Key elements:

- Role: medical device industry research analyst
- Task: find practicing medical professionals associated with a procedure/device
- Scoring rubric (embedded verbatim from Part 1 of this doc)
- Honesty policy (embedded verbatim)
- Tool: `web_search(query: string) -> SearchResult[]`
- Output format: JSON array of candidates matching the TypeScript interface
- Geographic constraints (if any)
- Explicit instruction to expand procedure synonyms/abbreviations
- Explicit instruction to search across PubMed, hospital sites, Doximity,
  conference proceedings, specialty journals, and professional directories

## Tool Definition for Claude

```typescript
{
  name: "web_search",
  description: "Search the web using Brave Search. Returns titles, snippets, and URLs.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query. Be specific — include procedure names, physician names, institution names, and relevant medical terminology."
      }
    },
    required: ["query"]
  }
}
```

## TypeScript Interfaces

```typescript
interface Candidate {
  rank: number;
  name: string;              // "Amy E. Krambeck, MD"
  notes: string;             // "World leader in HoLEP. 754 procedures in 2024..."
  institution: string;       // "Northwestern University"
  city: string;              // "Chicago, IL"
  specialty: string;         // "Urology"
  evidence: string;          // "Lead author on 2024 SAGE review..."
  source: string;            // "Urology Times; SAGE Journals doi:10.1177/..."
  profileLink: string | null;// "https://..." or null
  confidence: number;        // 1–100
}

interface SearchRequest {
  anthropicKey: string;
  braveSearchKey: string;
  procedure: string;
  region?: string;
  countries?: string[];
  resultCount: number;
}

interface SearchResponse {
  candidates: Candidate[];
  metadata: {
    procedure: string;
    geography: string | null;
    totalDiscoverySearches: number;
    totalVettingSearches: number;
    candidatesDropped: number;
    timestamp: string;
  };
}
```

## CSV Export

The download button generates a CSV with all columns from the Candidate
interface. The Notes field is included as-is (quoted to handle commas).
Filename: `medscout_{procedure}_{date}.csv`

## Frontend State Machine

```
IDLE
  → user fills form, clicks Search
SEARCHING
  → progress events update counter ("Vetting 7 of 20...")
  → spinner visible
RESULTS
  → table rendered, CSV download enabled
ERROR
  → error message displayed, user can retry
```

## Running Locally

```bash
cd medscout
bun install
bun dev              # Starts at http://localhost:3000
```

No environment variables needed — all API keys come from the user via the UI.
No timeout limits when running locally.

## Future: Vercel Deployment

When ready to deploy publicly:

```bash
cd medscout
bun run build        # Verify build locally
vercel --prod        # Deploy to Vercel
```

Note: Vercel Hobby (free) has a 60-second function timeout. A 20-result query
takes 2-4 minutes. Vercel Pro ($20/mo) extends the timeout to 300 seconds.
For V1, running locally avoids this constraint entirely.

## Cost Model

| Resource | Cost | Notes |
|---|---|---|
| Local hosting | Free | `bun dev` on your machine |
| Anthropic API (Sonnet 4.6) | ~$0.02-0.10 per query | Depends on token count; user pays |
| Brave Search API | Free for 2,000 queries/month | ~25 searches per 20-result query = ~80 queries/day free |

A typical 20-result query uses ~25 Brave searches and ~50K-100K Claude tokens.
