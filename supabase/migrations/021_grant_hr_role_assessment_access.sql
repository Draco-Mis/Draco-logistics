-- =============================================
-- Migration 021: 讓 hr 角色擁有與 admin / director 相同的邏輯測試權限
-- 請在 Supabase SQL Editor 中執行此檔案
-- =============================================
--
-- 改動的 RLS / 函式：is_hr_role()
-- 函式被以下 policy 使用：
--   - assessment_events: SELECT / INSERT / UPDATE
--   - assessment_submissions: SELECT / UPDATE
-- 改完後，hr 角色就能：
--   - 看 /admin/assessments 列表與單筆結果（含逐題解析）
--   - 建立 / 刪除測驗活動
--   - 查看員工作答 submissions

CREATE OR REPLACE FUNCTION is_hr_role()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
      AND is_active = true
      AND role IN ('admin', 'director', 'hr')
  );
$$;

GRANT EXECUTE ON FUNCTION is_hr_role() TO authenticated;
