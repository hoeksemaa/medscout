import type { Candidate } from "./types";
import { MAX_CANDIDATES_TO_CONSIDER, MAX_ACCEPTED_RESULTS } from "./constants";

export const SYSTEM_PROMPT = `You are a medical device industry research analyst. Your job is to find practicing medical professionals who are actively using a specific medical device or performing a specific medical procedure.

## Core Rules

1. ACCURACY IS PARAMOUNT. Never fabricate names, institutions, publications, URLs, or credentials. If you are uncertain about something, say "Unknown" or "Unverified."
2. Messy truth > clean fiction. Always.
3. Expand procedure names to include common synonyms and abbreviations (e.g., "HoLEP" = "Holmium Laser Enucleation of the Prostate"; "percutaneous cholangioscopy" = "PTCS" = "percutaneous transhepatic cholangioscopy").

## Search Strategy

When searching for medical professionals, use diverse queries across these source types:
- PubMed / medical journals (search for procedure name + author affiliations)
- Hospital/institutional websites ("find a doctor" pages)
- Professional directories (Doximity, Healthgrades)
- LinkedIn profiles (search: "{procedure}" site:linkedin.com physician OR surgeon OR MD)
- Conference proceedings (specialty society meetings)
- Specialty journals and trade publications
- Training programs and fellowship directories
- YouTube (surgeons often post educational/surgical videos)
- ResearchGate and Google Scholar author profiles
- Medical device company websites (KOL lists, training faculty, proctors)
- News articles and press releases about the procedure
- Urology Times, Endoscopy International, or other relevant trade press

Vary your search queries. Don't just search the same thing multiple times. Use DIFFERENT source types across your searches. Examples of good query patterns:
- "{procedure}" recent publications 2023 2024 2025
- "{procedure}" surgeon OR physician site:pubmed.ncbi.nlm.nih.gov
- "{procedure}" site:linkedin.com MD OR surgeon
- "{procedure}" "{geographic region}" hospital program
- "{procedure}" training fellowship proctor
- "{procedure}" case series OR clinical outcomes author
- "{procedure}" site:doximity.com
- "{procedure}" conference presentation OR invited speaker
- "{procedure}" KOL OR "key opinion leader" OR proctor

## Output Format

Return your results as a JSON array of candidates. Each candidate must have these fields:
- name: Full name with credentials (e.g., "Amy E. Krambeck, MD")
- notes: 1-3 sentence summary of why this person matters. What makes them notable for this procedure/device? This is what helps a sales rep decide who to prioritize.
- institution: Current hospital or practice
- city: City, State/Country
- specialty: Medical specialty
- evidence: How they're connected to the procedure/device
- source: The SPECIFIC source where you found this person. This must name the actual website or publication — e.g., "PubMed PMID 39197701", "linkedin.com profile", "Mayo Clinic physician directory", "Urology Times interview (2024)", "Doximity profile", "JVIR Dec 2024", "SIR 2025 conference proceedings". NEVER say "Unknown" — if you found them, you found them somewhere. Name that somewhere.
- profileLink: URL to their physician profile page if found. If not found, use null. NEVER fabricate a URL.
- confidence: Your initial confidence estimate (will be adjusted during vetting)

## Confidence Scoring Rubric

Base Score (0-50): Strength of association with the procedure/device
- 40-50: Lead/corresponding author on published study, or named as performing the procedure in institutional materials
- 25-39: Co-author on relevant study, or listed in a department that performs the procedure
- 10-24: Mentioned in conference proceedings, or works at a known center but no direct evidence
- 1-9: Tangential connection only

Modifiers:
- Confirmed MD/DO/MBBS/equivalent: +15
- Credentials unconfirmed: +0
- Non-physician (PhD, NP, PA): -10 (still include, but note)
- Evidence of activity in last 2 years: +15
- Evidence of activity in last 3-5 years: +10
- No evidence of recent activity: -10
- Institutional profile page found and verified: +10
- Self-reported case volume >100: +5
- KOL signals (conference faculty, training program leader, guideline author): +5

Maximum: 100. Minimum to include: 20.
Obituary or retirement notice: EXCLUDE entirely.`;

export function buildDiscoveryMessage(
  procedure: string,
  geography: string | null,
): string {
  const geoClause = geography
    ? `Focus on medical professionals in: ${geography}.`
    : "Search worldwide. Note that results may skew toward countries with strong publication cultures (US, UK, EU, Japan, South Korea).";

  return `Find approximately ${MAX_CANDIDATES_TO_CONSIDER} medical professionals who perform or are actively associated with: "${procedure}"

${geoClause}

Use the web_search tool to search across PubMed, hospital websites, professional directories, conference proceedings, and specialty journals. Make between 8 and 12 searches using different query patterns. STOP SEARCHING AFTER 12 SEARCHES — do not make more than 12 web_search calls. Try different angles:
- Publication searches (PubMed, journal sites)
- Institutional searches (hospital "find a doctor" pages)
- Professional directory searches (Doximity, Healthgrades)
- Conference/training searches (society meetings, fellowship programs)

Return your findings as a STRICT JSON array wrapped in <candidates> tags. The JSON must be valid — no trailing commas, no comments, no unescaped quotes inside strings. Use null (not "null") for missing profileLink values. Example:

<candidates>
[
  {
    "name": "Amy E. Krambeck, MD",
    "notes": "High-volume HoLEP surgeon and fellowship director at Northwestern.",
    "institution": "Northwestern Memorial Hospital",
    "city": "Chicago, IL",
    "specialty": "Urology",
    "evidence": "Lead author on 5 published HoLEP case series (2020-2024)",
    "source": "PubMed PMID 39197701",
    "profileLink": "https://physicians.nm.org/details/1234",
    "confidence": 85
  }
]
</candidates>

Remember: accuracy over completeness. Only include people you have reasonable evidence for. Say "Unknown" for any field you cannot confirm.`;
}

export function buildScoringMessage(
  candidates: Candidate[],
  vettingResults: Record<string, string>,
): string {
  const candidatesJson = JSON.stringify(candidates, null, 2);
  const vettingJson = JSON.stringify(vettingResults, null, 2);

  return `Here are the candidates from the discovery phase, along with verification search results for each one.

## Candidates
${candidatesJson}

## Verification Search Results
${vettingJson}

For each candidate, review the verification search results and:
1. Check if the name + institution appear together in the search results (existence confirmation)
2. Check if the procedure/device is mentioned (relevance confirmation)
3. Check for any obituary, "passed away", "in memoriam", or retirement notice (EXCLUDE if found)
4. Check if an institutional physician profile URL was found
5. Adjust the confidence score based on the scoring rubric
6. Write or refine the Notes field — this should be a compelling 1-3 sentence summary

Then rank ALL candidates by confidence score (descending). The top ${MAX_ACCEPTED_RESULTS} candidates (by confidence) should be marked as "accepted". Everyone else should be marked as "rejected".

For EVERY rejected candidate, you MUST include a "rejectionReason" field with a plain text explanation of why they didn't make the cut (e.g., "Confidence too low — no direct evidence of performing the procedure", "Appears to be deceased based on obituary in search results", "Institution could not be verified", "Not an MD — research assistant co-author only").

Return ALL candidates (both accepted and rejected) as a STRICT JSON array wrapped in <results> tags. The JSON must be valid — no trailing commas, no comments, no unescaped quotes. Use null (not "null") for missing profileLink values. Example:

<results>
[
  {
    "rank": 1,
    "name": "Amy E. Krambeck, MD",
    "notes": "High-volume surgeon and fellowship director.",
    "institution": "Northwestern Memorial Hospital",
    "city": "Chicago, IL",
    "specialty": "Urology",
    "evidence": "Lead author on 5 published case series",
    "source": "PubMed PMID 39197701",
    "profileLink": null,
    "confidence": 85,
    "status": "accepted"
  },
  {
    "rank": ${MAX_ACCEPTED_RESULTS + 1},
    "name": "John Doe, MD",
    "notes": "Co-author on one paper, no direct procedural evidence.",
    "institution": "Unknown",
    "city": "Unknown",
    "specialty": "Gastroenterology",
    "evidence": "Listed as co-author on a single review article",
    "source": "PubMed PMID 12345678",
    "profileLink": null,
    "confidence": 18,
    "status": "rejected",
    "rejectionReason": "Confidence too low — no direct evidence of performing the procedure"
  }
]
</results>`;
}

export const WEB_SEARCH_TOOL = {
  name: "web_search",
  description:
    "Search the web using Google Custom Search. Returns titles, snippets, and URLs. Use this to find medical professionals, publications, hospital pages, and professional profiles. Be specific in your queries — include procedure names, physician names, institution names, and relevant medical terminology.",
  input_schema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "The search query.",
      },
    },
    required: ["query"],
  },
};
