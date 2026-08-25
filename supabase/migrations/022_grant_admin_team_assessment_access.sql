-- =============================================
-- Migration 022: 課別=管理部 的使用者擁有與 admin / director / hr 相同的邏輯測試權限
-- 請在 Supabase SQL Editor 中執行此檔案
-- =============================================
--
-- 改動：is_hr_role() 函式追加 (team = '管理部') 為合格條件
-- 影響：assessment_events / assessment_submissions 的所有 RLS policy

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
      AND (
        role IN ('admin', 'director', 'hr')
        OR team = '管理部'
      )
  );
$$;

GRANT EXECUTE ON FUNCTION is_hr_role() TO authenticated;
