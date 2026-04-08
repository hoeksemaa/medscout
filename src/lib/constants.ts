/** Price in USD to unlock a single search result set */
export const UNLOCK_PRICE_USD = 1;

/** Number of results shown unblurred in a locked search */
export const VISIBLE_RESULTS_COUNT = 3;

/** Max web searches during the discovery phase (single agentic loop) */
export const MAX_DISCOVERY_SEARCHES = 50;

/** Max web searches per candidate in the research phase */
export const MAX_RESEARCH_SEARCHES_PER_CANDIDATE = 10;

/** Candidates per LLM call during filtering */
export const FILTERING_BATCH_SIZE = 30;

/** Max candidates marked "accepted" in final output */
export const MAX_ACCEPTED_RESULTS = 100;

/** Minimum password length for account creation */
export const MIN_PASSWORD_LENGTH = 16;
