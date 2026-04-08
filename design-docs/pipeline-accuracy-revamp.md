# Pipeline Accuracy Revamp

---

# Files

```
src/
├── lib/
│   ├── types.ts              — TypeScript interfaces: pipeline phase contracts, updated Candidate, new SSEEvent variants
│   ├── constants.ts          — New constants: discovery cap (100), batch sizes, research cap per candidate (5)
│   ├── prompts.ts            — Rewritten: discovery, filtering, research system prompts and message builders
│   ├── web-search.ts         — Web search provider (unchanged, shared with medical-professional-discovery-search.md)
│   ├── use-search.ts         — Updated client hook: new state machine with progressive name streaming + final reveal
│   ├── countries.ts          — Geography utilities (unchanged, shared with medical-professional-discovery-search.md)
│   ├── stripe.ts             — Stripe client (unchanged, shared with medical-professional-discovery-search.md)
│   ├── utils.ts              — cn() helper (unchanged, shared with medical-professional-discovery-search.md)
│   └── supabase/
│       ├── client.ts         — Browser Supabase client (unchanged, shared)
│       ├── server.ts         — Server Supabase client (unchanged, shared)
│       ├── service.ts        — Service-role Supabase client (unchanged, shared)
│       └── proxy.ts          — Auth middleware (unchanged, shared)
│
├── components/
│   ├── dr-yellowpages-app.tsx     — Updated: handles new search states, progressive name list + final results reveal
│   ├── search-progress.tsx        — Updated: new phase labels, live name list display during pipeline execution
│   ├── results-table.tsx          — Updated: receives final scored results after pipeline completes
│   ├── search-form.tsx            — Search input (unchanged, shared with medical-professional-discovery-search.md)
│   ├── nav-header.tsx             — Header bar (unchanged, shared)
│   └── ui/                        — shadcn/ui primitives (unchanged, shared)
│
└── app/
    ├── history/
    │   └── [id]/
    │       └── page.tsx           — Updated: metadata field names aligned with new pipeline (filtering/research instead of vetting)
    └── api/
        └── search/
            └── route.ts           — Rewritten: four-phase pipeline (discovery → filtering → research → score), SSE streaming

supabase/
└── migrations/
    └── 002_pipeline_revamp.sql    — Renames vetting→filtering columns, adds research columns
```

---

# What to Build

## Design Philosophy

**Client trust is the north star.** Every design decision — from name deduplication to result ordering to professional name formatting — should pass one test: does this make us look serious to serious people?

Medical device companies are staffed by sharp, skeptical professionals. Duplicate names, missing leaders, sloppy ranking, or unfamiliar formatting erode trust fast. The pipeline should present the truth and give itself the tools to find a strong version of that truth — no artificial boosting, no score inflation, no fabricated confidence.

If an established leader in the field is actively practicing a procedure, they should rise to the top naturally because the evidence for them is dense and recent. We don't engineer that outcome; we engineer a process where that outcome is inevitable.

**The principle of surprise.** A great result set isn't just the names a client already knows — it's those names *plus* a few they didn't expect. When a client sees 8 familiar leaders and 2 names that make them say "huh, I hadn't heard of this person — oh wow, you're right," that's the moment the tool proves its value. Breadth of discovery exists to serve this: cast wide enough that the net catches both the obvious and the non-obvious.

## Pipeline Overview

Four phases, executed sequentially:

```
User Query
    ↓
[1. DISCOVERY]     — Cast a wide net. Find names. Up to 100 web searches.
    ↓
    candidate names + brief notes
    ↓
[2. FILTERING]     — Deduplicate, disqualify. One search per candidate.
    ↓
    cleaned, deduplicated candidate list
    ↓
[3. RESEARCH]      — Deep per-person dive. Parallel agents, up to 5 searches each.
    ↓
    summary + score per candidate
    ↓
[4. SCORE]         — Mechanical sort by score. Accept/reject cutoff.
    ↓
Final Results
```

### Phase 1: Discovery

**Purpose:** Build the largest viable candidate pool possible.

Discovery does not care about how expert someone is. It cares about a binary: is this person a viable potential candidate for the given procedure or device? Yes → add to the list. No → skip.

The LLM runs batched search rounds. Each round executes up to 10 web searches, then emits a running candidate list. Between rounds, the LLM carries forward the accumulated names and brief notes (to avoid re-discovering the same people). The cap is 100 total searches, but the LLM should stop early if it senses it has exhausted the pool of reasonable candidates — a niche procedure with 15 practitioners in the world does not need 100 searches.

Discovery output per candidate is minimal: a name and a short note explaining why this person appeared (enough context for the filtering step to make merge/disqualification decisions without repeating searches). Each round returns only newly found candidates (not the full accumulated list). The LLM also emits an `exhausted` boolean — if true, discovery stops regardless of remaining search budget.

Geographic filters, when provided, are passed to the discovery prompt to focus the search (same as the existing system). Research and filtering do not use geography — they investigate specific people, not regions.

As names are discovered, they stream to the frontend immediately. The user sees a growing list of names in real time. No scores, no details — just names, in the order they were found.

### Phase 2: Filtering

**Purpose:** Deduplicate and disqualify before spending the research budget.

Filtering runs one web search per candidate — `"{Name}" {procedure or device}` — and uses the results to answer concrete questions:

- **Are there duplicates on this list?** "John Smith" and "Jack Smith" might be the same person. If one is cited 20 times for the procedure and the other has zero results, that's a merge-or-disqualify signal.
- **Is this person alive?**
- **Is this person retired?**
- **Is this person still practicing medicine?**
- **Is this person actually an MD (or equivalent)?**

The LLM evaluates candidates in batches, using the search results plus the discovery notes. It can also apply its own judgment about additional disqualifying factors.

When duplicates are merged, the most professional version of the name is kept (full credentials, proper formatting — "Robert J. Stein, MD" over "Rob Stein"). Notes are merged.

Aggressive deduplication bias: it is better to accidentally merge two different people than to show a client two entries for the same person. Visible duplicates endanger trust; a missing marginal candidate does not.

### Phase 3: Research

**Purpose:** Deep, unstructured dive into each surviving candidate. Understand who they are and how they relate to the procedure or device.

Each candidate gets an independent LLM agent with its own tool loop (up to 5 web searches). The agent investigates:

- Published articles, citation counts, recent publications
- LinkedIn profiles, professional directories
- Institutional physician profile pages
- Device company mentions, conference appearances
- Personal websites, YouTube channels, educational content
- Any other publicly available evidence of their relationship to the procedure/device

The agent uses up to 5 searches per candidate. It may stop early if it has built a complete picture before exhausting the budget, but should not cut research short based on a candidate looking "unpromising" — a candidate with thin early results may be a community practitioner or non-academic expert who proves to be a genuine surprise find.

Each research agent produces:
1. **A 1–2 sentence summary** of the candidate and their relationship to the procedure/device. This is the client-facing elevator pitch — professional, specific, informative. Answers "why should I care about this person?"
2. **An evidence trail** — the specific verifiable citations that support the summary. PubMed IDs, conference names, institutional URLs, device company listings. The receipts, not prose.
3. **A score from 1 to 100** based on an anchor rubric (see below).
4. **A disqualified flag** (boolean) if the agent discovers disqualifying information that filtering missed (obituary, retirement, not a medical professional). Includes a reason string. Disqualified candidates are excluded from final ranking but preserved in the audit log.

If a research agent fails (LLM error, search API failure), the server emits a degraded entry with score 0 and summary "Research unavailable — insufficient data to evaluate." The candidate sinks to the bottom naturally; the pipeline doesn't crash. If the failure rate across all agents exceeds ~20%, a warning surfaces in the SSE stream.

### Phase 4: Score

**Purpose:** Mechanical. Sort candidates by research score descending, assign ranks 1–N (ranking is a side effect of the score). Mark the top `MAX_ACCEPTED_RESULTS` as accepted, the rest as rejected. No LLM involvement.

## Scoring Rubric

Scores are assigned independently by each research agent against a shared anchor scale. No candidate-vs-candidate comparison. The anchors ensure calibration across agents.

### Anchors

| Score | Profile |
|---|---|
| **~100** | Undisputed leader. Most-cited academic on this procedure. Has performed hundreds of cases. Widely regarded as the best in the field. Conference keynote speaker, guideline author, fellowship director. |
| **~75** | Clearly practicing. Regular performer of the procedure. Published but not top-cited. Known within the specialty but not a household name. Solid institutional affiliation. |
| **~50** | Has performed the procedure or is clearly associated with it, but limited evidence of volume or expertise. May have few or no citations. Uncertain whether they are an active, high-frequency practitioner. |
| **~25** | Tangential connection. Works in the right department but no direct evidence of performing the procedure. May be a co-author on a single paper. Might be a researcher rather than a practitioner. |

### Bias Factors

These do not have fixed point values. They should nudge the agent's judgment up or down relative to the anchors.

**Upward bias:**
- Recent activity (publications, conference appearances, institutional profile updates within last 2 years)
- High citation count on procedure-relevant papers
- KOL signals: conference faculty, training program leader, guideline author, device company proctor
- Confirmed credentials (MD, DO, MBBS, or equivalent)
- Verified institutional profile page
- Self-reported or documented high case volume

**Downward bias:**
- No evidence of recent activity
- Credentials unconfirmed
- Non-physician (PhD, NP, PA) — still include, but note and bias down
- Tangential connection to the procedure (same department, different subspecialty)
- Evidence is thin or ambiguous

**Disqualify entirely (should have been caught in Filtering, but as a safety net):**
- Obituary or retirement notice
- Not a medical professional
- Clearly does not perform this procedure

### Why No Rigid Point System

Different procedures and devices have different evidence landscapes. A highly academic procedure (e.g., a novel surgical technique with extensive literature) naturally biases toward citation-heavy candidates. A procedure used mainly by community practitioners may have almost no academic literature — expertise shows up in patient reviews, hospital marketing pages, and device company proctoring lists. A rigid +15 / -10 rubric can't adapt to this variation. Anchor-based scoring with qualitative bias factors lets each agent calibrate to the evidence landscape it encounters.

## Progressive Streaming UX

The frontend experience during a search:

1. **Discovery phase:** A live, growing list of candidate names appears as they're found. No scores, no details — just names in discovery order. The user watches the list build.
2. **Filtering phase:** Progress indicator ("Filtering 47 of 132 candidates..."). The name list may shrink as duplicates merge and disqualified candidates disappear.
3. **Research phase:** Progress indicator ("Researching 18 of 98 candidates..."). Names remain visible but still no details.
4. **Completion:** The name list is replaced by the full results view — ranked cards with scores, summaries, institutions, sources, and all detail fields. This is the "reveal" moment.

During phases 1–3, only names are visible. The user cannot see scores, summaries, or details until the pipeline completes. This avoids showing partial/misleading information and creates a satisfying reveal when everything lands at once.

## Data Contracts Between Phases

Loose schemas with good logging. The purpose is debuggability — "this search went sideways, let me inspect what discovery emitted and what filtering did with it." Not evaluation harnesses or deterministic diffing (those may come later).

### Discovery Round Output

```
{ candidates: { name: string, notes: string }[], exhausted: boolean }
```

`name` is however the LLM found it (may include credentials, may not). `notes` is a brief scribble — why this person appeared, what search found them. `exhausted` signals the LLM believes the candidate pool is tapped. Each round returns only newly found candidates; the server appends to the running list.

### Discovery → Filtering

```
{ name: string, notes: string }[]
```

The full accumulated list from all rounds. Names are unprocessed (not yet normalized or deduplicated).

### Filtering → Research

```
{ name: string, notes: string }[]
```

Same shape, but names are now normalized (most professional variant) and the list is deduplicated and vetted. Notes may be merged from duplicates.

### Research → Score

```
{ name: string, summary: string, evidence: string, score: number, institution: string, city: string, specialty: string, source: string, profileLink: string | null, disqualified: boolean, disqualificationReason?: string }[]
```

Each research agent populates all candidate fields. `summary` is the 1–2 sentence client-facing elevator pitch. `evidence` is the verifiable citation trail (PubMed IDs, conference names, URLs). `score` is 1–100 per the anchor rubric. `disqualified` is true if the agent found disqualifying information that filtering missed.

## Success Criteria

A query is successful if:

1. Every name is a real person (zero fabrications)
2. Known leaders in the field appear in the top 10–20 results
3. The results include names a knowledgeable insider would recognize, plus a few that genuinely surprise them — that's the value proposition (the "principle of surprise")
4. No visible duplicates
5. Scores feel intuitively right — the person at #1 should obviously be #1
6. Every source citation is verifiable
7. The pipeline completes without timeout (may take several minutes — that's acceptable)

---

# How to Build It

## Pipeline Orchestration

The `POST /api/search` route remains the single entry point. It orchestrates all four phases sequentially, streams SSE events throughout, and persists results to Supabase.

### Phase 1: Discovery — Batched Agentic Loop

Discovery runs in rounds. Each round is one LLM call with the `web_search` tool, hard-capped at 10 tool calls per round by the server.

**Batch termination mechanics:** The LLM gets a soft instruction ("you have up to 10 searches this round"), but the server enforces the cap. After 10 tool executions in a round, the server makes one final LLM call **without `web_search` in the tools array**. The LLM is forced to respond with text (the candidates JSON) since it can't call tools. This is reliable and matches the existing Anthropic SDK tool-use loop — just add a counter and remove tool access when it's hit.

**Between rounds**, the server extracts newly discovered candidates from the LLM's response and appends them to a running candidate list. The next round's prompt includes the accumulated list so the LLM knows who it's already found and can search different angles.

**Pool exhaustion signal:** Each round's JSON output includes an `exhausted: boolean`. If true, discovery stops regardless of remaining budget. If the LLM returns zero new candidates, that's implicit exhaustion regardless of the flag.

**Round structure:**
1. Build prompt: procedure, geography, accumulated candidates so far, remaining search budget
2. LLM agentic loop: calls `web_search` up to 10 times (server hard-caps), then emits new candidates + exhausted flag
3. Server parses new candidates, appends to running list
4. If total searches >= `MAX_DISCOVERY_SEARCHES` (100) OR exhausted → stop
5. Otherwise → next round

**SSE during discovery:** After each round completes, a `candidates_discovered` event streams the full current name list to the frontend. The frontend renders it as a growing list.

### Phase 2: Filtering — Batched LLM Evaluation

**Step 1: Per-candidate search.** For each discovery candidate, run a direct (non-LLM) web search: `"{Name}" {procedure}`. Store results keyed by candidate name. This is the same pattern as the current vetting phase — fast, deterministic, no LLM tokens.

**Step 2: LLM evaluation in batches.** Group candidates into batches of ~30. For each batch, pass the candidates (names + discovery notes) and their search results to the LLM. The prompt asks the LLM to:
- Identify and merge duplicates (using search results as evidence — "Jack Smith" has zero results but "John A. Smith, MD" at the same institution has 20)
- Disqualify: dead, retired, not practicing, not an MD
- Normalize names to their most professional variant
- Return the cleaned list

**Cross-batch dedup:** After all batches are processed, run one final LLM pass across the merged output to catch duplicates that span batch boundaries. This call is smaller (just names + notes, no search results).

**SSE during filtering:** Progress counter ("Filtering {N} of {total}..."). Names that get filtered out disappear from the frontend list (via `candidates_filtered` events that send the updated name list).

### Phase 3: Research — Parallel Per-Candidate Agents

For each surviving candidate, spawn an independent LLM call with `web_search` tool access (up to `MAX_RESEARCH_SEARCHES_PER_CANDIDATE` searches, default 5).

**Research agent prompt:** See "Draft Prompts" section below for full text.

**Parallelism:** Research agents run concurrently using `p-limit` (npm package) with a concurrency of 10. Results collected via `Promise.allSettled` — failed agents produce degraded entries (score 0, "Research unavailable" summary) rather than crashing the pipeline. If >20% of agents fail, a warning event is sent via SSE.

**SSE during research:** Progress counter ("Researching {N} of {total}..."). Updated each time an agent completes (success or failure).

### Phase 4: Score

Purely mechanical. No LLM.

1. Collect all research outputs
2. Filter out `disqualified: true` candidates (preserved in audit log, excluded from ranked results)
3. Mark degraded entries from failed research agents as rejected (status: "rejected", rejection reason: "Research incomplete — insufficient data to evaluate")
4. Sort remaining non-rejected by score descending
5. Assign rank 1–N (ranking is a side effect of the score)
6. Top `MAX_ACCEPTED_RESULTS` → status: "accepted"
7. Remainder → status: "rejected" (rejection reason: "Below acceptance threshold")
8. Persist to Supabase
9. Stream final `result` event with full `SearchResponse`

## Updated Constants

```typescript
/** Max web searches during the discovery phase */
export const MAX_DISCOVERY_SEARCHES = 100;

/** Web searches per discovery batch (one LLM call) */
export const DISCOVERY_BATCH_SIZE = 10;

/** Max web searches per candidate in the research phase */
export const MAX_RESEARCH_SEARCHES_PER_CANDIDATE = 5;

/** Candidates per LLM call during filtering */
export const FILTERING_BATCH_SIZE = 30;

/** Max candidates marked "accepted" in final output */
export const MAX_ACCEPTED_RESULTS = 100;
```

`MAX_CANDIDATES_TO_CONSIDER` (200) is removed — discovery is no longer capped by candidate count, only by search count.

## Updated Types

### Intermediate Phase Contracts

```typescript
/** Discovery round LLM output */
interface DiscoveryRoundOutput {
  candidates: DiscoveryCandidate[];
  exhausted: boolean;
}

/** Discovery output — minimal, names only */
interface DiscoveryCandidate {
  name: string;
  notes: string;
}

/** Filtering output — same shape, cleaned */
interface FilteredCandidate {
  name: string;
  notes: string;
}

/** Research output — full candidate with score */
interface ResearchedCandidate {
  name: string;
  summary: string;
  evidence: string;
  score: number;
  institution: string;
  city: string;
  specialty: string;
  source: string;
  profileLink: string | null;
  disqualified: boolean;
  disqualificationReason?: string;
}
```

### Updated Final Candidate

The existing `Candidate` interface gets minor renames to align with the new pipeline:
- `notes` → renamed to `summary` (the research agent's 1–2 sentence output)
- `confidence` → renamed to `score` (anchor-rubric based, not additive confidence)
- `evidence` field is preserved but now contains the verifiable citation trail (not prose)

### Updated SSE Events

```typescript
type SSEEvent =
  | { type: "progress"; phase: "discovery" | "filtering" | "research"; message: string; current?: number; total?: number }
  | { type: "candidates_discovered"; names: string[] }
  | { type: "candidates_filtered"; names: string[] }
  | { type: "result"; data: SearchResponse; searchId?: string | null }
  | { type: "error"; message: string }
  | { type: "done" };
```

`candidates_discovered` streams the current full name list (not deltas) after each discovery round. `candidates_filtered` streams the updated name list after filtering removes/merges candidates.

## Updated Frontend State Machine

```
idle
  → search(params)
  ↓
discovering { names: string[], message }
  ← SSE candidates_discovered + progress events
  ↓
filtering { names: string[], message, current, total }
  ← SSE candidates_filtered + progress events
  ↓
researching { names: string[], message, current, total }
  ← SSE progress events
  ↓
results { data: SearchResponse, searchId }
  ← SSE result event (the "reveal" — full ranked results replace the name list)
  ↓
(or error at any point) → error message
```

During `discovering`, `filtering`, and `researching`, the UI shows a simple list of names (no cards, no scores, no details) plus the phase-appropriate progress indicator. On `results`, the full `ResultsTable` renders with the complete data.

## Updated Database Schema

The `searches` table needs updated columns to reflect the new phases:

- Rename `search_count_vetting` → `search_count_filtering`
- Add `search_count_research`
- Rename `duration_vetting_s` → `duration_filtering_s`
- Rename `duration_scoring_s` → `duration_research_s`

Audit log phases change from `"discovery" | "vetting" | "scoring"` to `"discovery" | "filtering" | "research"`.

A new migration handles column renames and additions. Existing data is preserved (old column values carry over to renamed columns).

## Updated Metadata

The `SearchResponse.metadata` object reflects the new phases:

```typescript
metadata: {
  procedure: string;
  geography: string | null;
  searchCountDiscovery: number;
  searchCountFiltering: number;
  searchCountResearch: number;
  timestamp: string;
}
```

## Prompt Architecture

Three distinct system prompts (one shared base, plus phase-specific extensions), plus message builders per phase.

### Draft Prompts

#### Shared System Prompt (Base)

Used by all LLM calls. Prepended to every phase-specific system prompt.

```
You are a medical device industry research analyst. Your work is used by medical device sales teams to find physicians who are actively using specific devices or performing specific procedures.

## Accuracy Rules

1. ACCURACY IS PARAMOUNT. Never fabricate names, institutions, publications, URLs, or credentials. If you are uncertain, say "Unknown" or "Unverified."
2. Messy truth > clean fiction. Always.
3. When you encounter a procedure or device name, expand it to include common synonyms and abbreviations (e.g., "HoLEP" = "Holmium Laser Enucleation of the Prostate").

## Honesty Policy

- If a field cannot be confirmed: "Unknown" or "Unverified"
- Never fabricate a URL, publication, or credential
- If credentials are uncertain: "Credentials unconfirmed"
- If you found someone but can't identify their source: say so honestly
```

#### Discovery System Prompt

Appended to the shared base for all discovery round calls.

```
## Your Role: Discovery

You are in the discovery phase. Your job is to cast the widest possible net and find names of medical professionals who may be associated with the given procedure or device.

You are NOT scoring, ranking, or deeply evaluating anyone. You care about one binary question per person: is this a viable potential candidate? Yes → add them. No → skip.

## Search Strategy

Use diverse queries across these source types:
- PubMed / medical journals (procedure name + author affiliations)
- Hospital/institutional websites ("find a doctor" pages)
- Professional directories (Doximity, Healthgrades)
- LinkedIn (site:linkedin.com "{procedure}" physician OR surgeon OR MD)
- Conference proceedings (specialty society meetings, invited speakers)
- Specialty journals and trade publications
- Training programs and fellowship directories
- YouTube (surgeons often post educational/procedural videos)
- ResearchGate and Google Scholar author profiles
- Medical device company websites (KOL lists, proctors, training faculty)
- News articles and press releases
- Relevant trade press (Urology Times, Endoscopy International, etc.)

Vary your queries across source types. Don't search the same angle twice. Cast wide — obvious names AND non-obvious ones.

## Output Format

Return ONLY newly found candidates (not ones already in the accumulated list) as a JSON object wrapped in <candidates> tags:

<candidates>
{
  "candidates": [
    { "name": "Amy E. Krambeck, MD", "notes": "Found via PubMed — lead author on HoLEP case series" },
    { "name": "Robert Stein", "notes": "Mentioned in Northwestern fellowship directory" }
  ],
  "exhausted": false
}
</candidates>

Set "exhausted" to true if you believe you have found the majority of viable candidates for this procedure — e.g., you are seeing the same names repeatedly across searches, or the procedure is niche enough that the pool is small. When in doubt, set false.

Keep notes brief — one sentence explaining where/why you found this person. Enough context for a later deduplication step, not a full evaluation.
```

#### Discovery Round User Message (built per round)

```
Find medical professionals who perform or are actively associated with: "{procedure}"

{geography clause — e.g., "Focus on: North America" or "Search worldwide."}

## Already Found ({N} candidates)
{accumulated name + notes list}

## This Round
You have up to {remaining} web searches remaining in your total budget. Use up to 10 searches this round. Search different angles from previous rounds — try source types you haven't explored yet.

If you believe you have exhausted the candidate pool (you keep finding the same people, or this is a niche procedure with a small number of practitioners), set "exhausted" to true and return whatever new candidates you found.
```

#### Filtering Prompt

The filtering prompt is more structured since it's an evaluation task, not an open-ended search.

**System prompt:** Shared base + filtering-specific instructions:

```
## Your Role: Filtering

You are in the filtering phase. You receive a batch of candidate names (with brief discovery notes) and one web search result per candidate. Your job is to clean this list:

1. DEDUPLICATE: Identify candidates who are the same person appearing under different names (e.g., "John Smith" and "John A. Smith, MD" at the same institution). Merge them, keeping the most professional name variant (full credentials, proper formatting). Merge their notes.

2. DISQUALIFY: Remove candidates if the evidence shows any of these:
   - Deceased (obituary, "in memoriam," "passed away")
   - Retired from clinical practice
   - No longer practicing medicine
   - Not a medical professional (e.g., a journalist or policy analyst who wrote about the procedure)
   - If uncertain, keep them — filtering should err on the side of inclusion

3. NORMALIZE NAMES: Use the most professional version. "Robert J. Stein, MD" over "Rob Stein." Include credentials when found.

## Deduplication Bias

Be aggressive. It is better to accidentally merge two different people than to let a client see two entries for the same person. Visible duplicates damage trust; a missing marginal candidate does not.

## Output Format

Return the cleaned list as JSON in <filtered> tags. Include only candidates who survive filtering:

<filtered>
[
  { "name": "Robert J. Stein, MD", "notes": "Merged from 'Rob Stein' and 'Robert Stein, MD'. Found via Cleveland Clinic directory and PubMed." },
  { "name": "Sonia Fernandez, MD", "notes": "Found via SIR 2024 conference proceedings." }
]
</filtered>
```

#### Research Agent System Prompt

```
## Your Role: Research

You are researching one specific medical professional to understand their relationship to a given procedure or device. You will conduct up to 5 web searches to build a complete picture.

## Search Strategy

Investigate across multiple angles:
- Published articles and citation counts (PubMed, Google Scholar)
- LinkedIn profile and professional background
- Institutional physician profile page
- Device company mentions (proctor lists, training faculty, KOL programs)
- Conference appearances (invited speaker, faculty, panelist)
- Personal website, YouTube channel, educational content
- Patient reviews or hospital marketing mentioning the procedure
- Any other publicly available evidence

## Budget Management

You have up to 5 searches. You may stop early if you have built a complete picture before using all 5. Do NOT cut research short just because early results look thin — a candidate with few academic citations may be a community practitioner or non-academic expert. Use the full budget to investigate thoroughly before scoring.

## Scoring Rubric

Score this candidate 1–100 against these anchors:

| Score | Profile |
|---|---|
| ~100 | Undisputed leader. Most-cited academic on this procedure. Hundreds of cases. Widely regarded as the best. Conference keynote, guideline author, fellowship director. |
| ~75  | Clearly practicing. Regular performer. Published but not top-cited. Known in the specialty. Solid institutional affiliation. |
| ~50  | Associated with the procedure, but limited evidence of volume or expertise. Few or no citations. Uncertain whether they are an active, high-frequency practitioner. |
| ~25  | Tangential connection. Right department but no direct evidence of performing the procedure. Co-author on a single paper. Possibly a researcher, not a practitioner. |

Bias upward for: recent activity (last 2 years), high citations, KOL signals (conference faculty, training program leader, guideline author, device proctor), confirmed MD/DO/MBBS, verified institutional profile, documented high case volume.

Bias downward for: no recent activity, unconfirmed credentials, non-physician (PhD, NP, PA — still include but note), tangential connection, thin or ambiguous evidence.

If you discover disqualifying information (obituary, retirement, not a medical professional, clearly does not perform this procedure), set disqualified to true with a reason.

## Output Format

Return a JSON object in <research> tags:

<research>
{
  "name": "Amy E. Krambeck, MD",
  "summary": "High-volume HoLEP surgeon and fellowship director at Northwestern. One of the most-published authors on laser enucleation outcomes.",
  "evidence": "Lead author on 12 HoLEP publications (PubMed). AUA 2024 invited faculty. Lumenis-listed proctor. Northwestern physician profile confirmed.",
  "score": 95,
  "institution": "Northwestern Memorial Hospital",
  "city": "Chicago, IL",
  "specialty": "Urology",
  "source": "PubMed, AUA 2024 proceedings, Northwestern physician directory",
  "profileLink": "https://physicians.nm.org/details/1234",
  "disqualified": false
}
</research>

- "summary": 1–2 sentences. Professional, specific. What a sales rep reads to decide if they care.
- "evidence": The verifiable receipts. PubMed IDs, conference names, institutional URLs, device company listings. Not prose — citations.
- "source": Where you found the most significant evidence. Be specific.
- "profileLink": Institutional profile URL if found. null if not. NEVER fabricate.
- "disqualified": true only if you found concrete disqualifying evidence. Include "disqualificationReason" if true.
```

#### Research Agent User Message (built per candidate)

```
Research this candidate's relationship to "{procedure}":

Name: {name}
Discovery notes: {notes}

Conduct up to 5 web searches. Produce a professional summary, evidence trail, and score per the rubric.
```

## Timeout and Cost Considerations

**Timeout:** The current 300s Vercel limit will likely be insufficient. With 100 discovery searches, ~150 filtering searches, and ~100 research agents each doing 3–5 searches, total wall-clock time could exceed 10 minutes. Options:
- Run locally during development (no timeout)
- Increase Vercel function duration (Enterprise tier supports longer)
- Accept that this is a long-running operation and design around it (background job + polling, or keep SSE alive)

This design doc does not prescribe the timeout solution — it depends on deployment constraints. The pipeline should work correctly regardless of timeout strategy.

**Cost per query (estimated):**
- Discovery: ~10 LLM calls (batched rounds) + ~100 Brave searches
- Filtering: ~150 Brave searches + ~5–6 LLM calls (batched evaluation) + 1 cross-batch dedup call
- Research: ~100 LLM calls (one per candidate) + ~300–500 Brave searches
- Total: ~115 LLM calls, ~550–750 Brave searches
- Estimated LLM cost: ~$0.50–2.00 per query (depending on model)
- Estimated Brave cost: significant at scale, well beyond free tier

Quality is the priority. Cost optimization is a later concern.

## What This Design Does NOT Cover

- Tunable parameters exposed to users (temperature, search count, model selection)
- Search variety/strategy selection UI
- Evaluation harnesses or A/B testing infrastructure
- Cost optimization or budget constraints
- Changes to authentication, billing, or payment flows
