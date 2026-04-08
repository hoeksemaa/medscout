-- 003_pipeline_state.sql
-- Add pipeline_state column for chained job execution.

alter table searches add column pipeline_state jsonb;
