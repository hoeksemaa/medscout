export interface Candidate {
  rank: number;
  name: string;
  summary: string;
  institution: string;
  city: string;
  specialty: string;
  evidence: string;
  source: string;
  profileLink: string | null;
  score: number;
  status: "accepted" | "rejected";
  rejectionReason?: string;
  rejectionStage?: "filtering" | "research" | "score";
}

/** Discovery output — minimal, names only */
export interface DiscoveryCandidate {
  name: string;
  notes: string;
}

/** Filtering output — same shape, cleaned */
export interface FilteredCandidate {
  name: string;
  notes: string;
}

/** Filtering rejection record */
export interface FilterRejection {
  name: string;
  rejectionReason: string;
}

/** Research output — full candidate with score */
export interface ResearchedCandidate {
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

/** Pipeline state persisted to Supabase between chunks */
export type PipelineStep =
  | { phase: "discovery"; round: number; candidates: DiscoveryCandidate[]; searchCount: number }
  | { phase: "filtering"; candidates: DiscoveryCandidate[] }
  | { phase: "research"; batch: number; surviving: FilteredCandidate[]; rejected: FilterRejection[]; researched: ResearchedCandidate[] }
  | { phase: "score"; surviving: FilteredCandidate[]; rejected: FilterRejection[]; researched: ResearchedCandidate[] }
  | { phase: "done" };

export interface PipelineState {
  step: PipelineStep;
  tokensIn: number;
  tokensOut: number;
  auditEntries: AuditEntry[];
  timings: { discoveryMs?: number; filteringMs?: number; researchMs?: number };
  searchCounts: { discovery?: number; filtering?: number; research?: number };
}

export interface AuditEntry {
  phase: "discovery" | "filtering" | "research";
  event_type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface SearchRequest {
  procedure: string;
  region?: string;
  countries?: string[];
}

export interface SearchResponse {
  candidates: Candidate[];
  metadata: {
    procedure: string;
    geography: string | null;
    searchCountDiscovery: number;
    searchCountFiltering: number;
    searchCountResearch: number;
    timestamp: string;
  };
}

export interface WebSearchResult {
  title: string;
  snippet: string;
  link: string;
}

export interface Region {
  name: string;
  description: string;
}

export interface Country {
  alpha3: string;
  name: string;
  region: string | null;
}

export interface CountriesData {
  regions: Record<string, Region>;
  countries: Country[];
}

export type SSEEvent =
  | { type: "progress"; phase: "discovery" | "filtering" | "research"; message: string; current?: number; total?: number }
  | { type: "candidates_discovered"; names: string[] }
  | { type: "candidates_filtered"; names: string[] }
  | { type: "candidates_rejected"; rejections: Array<{ name: string; reason: string }> }
  | { type: "candidate_researched"; candidate: ResearchedCandidate }
  | { type: "chunk_done"; searchId: string }
  | { type: "result"; data: SearchResponse; searchId?: string | null }
  | { type: "error"; message: string }
  | { type: "done" };

// ---------------------------------------------------------------------------
// Live leaderboard frontend types
// ---------------------------------------------------------------------------

export type CandidatePhase = "discovered" | "filtered" | "researched" | "ranked";

export interface LiveCandidate {
  name: string;
  phase: CandidatePhase;
  research?: ResearchedCandidate;
  rank?: number;
  finalStatus?: "accepted" | "rejected";
  rejectionReason?: string;
  rejectionStage?: "filtering" | "research" | "score";
}
