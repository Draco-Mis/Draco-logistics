-- =============================================
-- Migration 033: Big Five AI 分析兩種視角獨立儲存
-- 之前單一欄位 bigfive_ai_profile，切換視角會互相覆蓋
-- 改為兩個獨立欄位，分別存「管理職」與「基層員工」視角的報告
-- =============================================

ALTER TABLE assessment_submissions
  ADD COLUMN IF NOT EXISTS bigfive_ai_profile_manager TEXT DEFAULT NULL;
ALTER TABLE assessment_submissions
  ADD COLUMN IF NOT EXISTS bigfive_ai_profile_manager_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE assessment_submissions
  ADD COLUMN IF NOT EXISTS bigfive_ai_profile_staff TEXT DEFAULT NULL;
ALTER TABLE assessment_submissions
  ADD COLUMN IF NOT EXISTS bigfive_ai_profile_staff_at TIMESTAMPTZ DEFAULT NULL;

-- 把現有的 bigfive_ai_profile 依據 viewpoint 搬到對應欄位
UPDATE assessment_submissions
SET bigfive_ai_profile_manager = bigfive_ai_profile,
    bigfive_ai_profile_manager_at = bigfive_ai_profile_generated_at
WHERE bigfive_ai_profile IS NOT NULL
  AND (bigfive_ai_profile_viewpoint IS NULL OR bigfive_ai_profile_viewpoint = 'manager')
  AND bigfive_ai_profile_manager IS NULL;

UPDATE assessment_submissions
SET bigfive_ai_profile_staff = bigfive_ai_profile,
    bigfive_ai_profile_staff_at = bigfive_ai_profile_generated_at
WHERE bigfive_ai_profile IS NOT NULL
  AND bigfive_ai_profile_viewpoint = 'staff'
  AND bigfive_ai_profile_staff IS NULL;

NOTIFY pgrst, 'reload schema';
