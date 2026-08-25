-- =============================================
-- Migration 032: Big Five AI 分析支援不同視角
-- viewpoint 紀錄 AI 報告是用哪種視角生成（manager / staff）
-- =============================================

ALTER TABLE assessment_submissions
  ADD COLUMN IF NOT EXISTS bigfive_ai_profile_viewpoint TEXT DEFAULT NULL;

-- 現有的報告都標記為 manager（之前的 prompt 是管理視角）
UPDATE assessment_submissions
SET bigfive_ai_profile_viewpoint = 'manager'
WHERE bigfive_ai_profile IS NOT NULL
  AND bigfive_ai_profile_viewpoint IS NULL;

NOTIFY pgrst, 'reload schema';
