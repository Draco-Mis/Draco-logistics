-- =============================================
-- Migration 029: Big Five 人格特質測驗
-- 在現有 assessment_submissions 加上 bigfive 答題與計分欄位
-- 活動沿用 assessment_events.test_types（['logic'] 或 ['bigfive']）
-- =============================================

ALTER TABLE assessment_submissions
  ADD COLUMN IF NOT EXISTS bigfive_answers JSONB DEFAULT NULL;

ALTER TABLE assessment_submissions
  ADD COLUMN IF NOT EXISTS bigfive_scores JSONB DEFAULT NULL;

ALTER TABLE assessment_submissions
  ADD COLUMN IF NOT EXISTS bigfive_ai_profile TEXT DEFAULT NULL;

ALTER TABLE assessment_submissions
  ADD COLUMN IF NOT EXISTS bigfive_ai_profile_generated_at TIMESTAMPTZ DEFAULT NULL;
