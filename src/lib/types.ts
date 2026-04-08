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

/** Discovery round LLM output */
export interface DiscoveryRoundOutput {
  candidates: DiscoveryCandidate[];
  exhausted: boolean;
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
  | { type: "result"; data: SearchResponse; searchId?: string | null }
  | { type: "error"; message: string }
  | { type: "done" };
