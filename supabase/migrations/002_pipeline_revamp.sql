-- 002_pipeline_revamp.sql
-- Rename vetting columns to filtering, add research columns for four-phase pipeline.

-- Rename vetting → filtering
alter table searches rename column search_count_vetting to search_count_filtering;
alter table searches rename column duration_vetting_s to duration_filtering_s;

-- Rename scoring → research (the old "scoring" timing slot now tracks research)
alter table searches rename column duration_scoring_s to duration_research_s;

-- Add research search count
alter table searches add column search_count_research int;
