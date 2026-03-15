-- Venture Pipeline: Add new status values and pipelineData column
-- This migration extends the venture_idea_status enum and adds the pipeline tracking column

-- Add new enum values (PostgreSQL requires ALTER TYPE ... ADD VALUE)
ALTER TYPE "venture_idea_status" ADD VALUE IF NOT EXISTS 'validating' AFTER 'researched';
ALTER TYPE "venture_idea_status" ADD VALUE IF NOT EXISTS 'validated' AFTER 'validating';
ALTER TYPE "venture_idea_status" ADD VALUE IF NOT EXISTS 'pipeline' AFTER 'compiling';

-- Add pipelineData JSONB column to venture_ideas table
ALTER TABLE "venture_ideas" ADD COLUMN IF NOT EXISTS "pipeline_data" jsonb;
