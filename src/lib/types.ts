export interface Candidate {
  rank: number;
  name: string;
  notes: string;
  institution: string;
  city: string;
  specialty: string;
  evidence: string;
  source: string;
  profileLink: string | null;
  confidence: number;
  status: "accepted" | "rejected";
  rejectionReason?: string;
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
    searchCountVetting: number;
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
  | { type: "progress"; phase: "discovery" | "vetting" | "scoring"; message: string; current?: number; total?: number }
  | { type: "result"; data: SearchResponse; searchId?: string | null }
  | { type: "error"; message: string }
  | { type: "done" };
