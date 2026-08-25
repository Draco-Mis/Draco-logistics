-- =============================================
-- Migration 026: 「管理部」+「財務部」整併為「財管部」
-- 請在 Supabase SQL Editor 中執行此檔案
-- =============================================
--
-- 1. 先 DROP 舊 CHECK 約束（不然 UPDATE 到「財管部」會被擋）
-- 2. UPDATE 資料：管理部 / 財務部 → 財管部
-- 3. ADD 回新 CHECK 約束
-- 4. 重建 can_manage_employees() 函式改認「財管部」

-- 1. 暫時解除 team CHECK
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_team_check;

-- 2a. users 表：把「管理部」歸入「財管部」
UPDATE users SET team = '財管部' WHERE team = '管理部';

-- 2b. 評估作答紀錄的 department 欄位（自由文字、無 CHECK），把舊值整併
UPDATE assessment_submissions SET department = '財管部'
WHERE department IN ('管理部', '財務部');

-- 3. 加回新 CHECK 約束
ALTER TABLE users ADD CONSTRAINT users_team_check CHECK (team IN (
  -- 業務部門
  '業一課', '業二課', '專案課', '電商課',
  -- 管理與其他
  '管理員', '業務部', '報關部',
  '財管部',  -- 由「管理部」改名 + 與「財務部」整併
  -- 物流部 (含子課)
  '物流一部', '物流二部',
  '物流一部遠洋課', '物流一部大陸課', '物流一部大陸進口課',
  '物流二部空運課', '物流二部三角課',
  -- 關係企業
  '崧盛'
));

-- 4. 重建 employees 名冊權限函式（migration 025 原本檢查「管理部」）
CREATE OR REPLACE FUNCTION can_manage_employees()
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
        role IN ('admin', 'chairman', 'director', 'hr')
        OR team = '財管部'
      )
  );
$$;
