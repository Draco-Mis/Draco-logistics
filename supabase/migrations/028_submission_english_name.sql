-- =============================================
-- Migration 028: assessment_submissions.english_name
-- 受測者作答時自動帶入員工名冊裡的英文名
-- =============================================

ALTER TABLE assessment_submissions
  ADD COLUMN IF NOT EXISTS english_name TEXT DEFAULT NULL;

-- 把現有資料的 english_name 從 employees 名冊回填（依中文姓名比對）
UPDATE assessment_submissions s
SET english_name = e.english_name
FROM employees e
WHERE s.english_name IS NULL
  AND s.respondent_name = e.chinese_name
  AND e.english_name IS NOT NULL;
