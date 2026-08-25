-- =============================================
-- Migration 020: 新增「財務 / 人資」角色 與「管理部」課別
-- 請在 Supabase SQL Editor 中執行此檔案
-- =============================================

-- 1. 擴充 users.role CHECK：加入 finance / hr
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN (
  'admin',
  'chairman',
  'director',
  'manager',
  'sales',
  'finance',  -- 新增：財務
  'hr'        -- 新增：人資
));

-- 2. 擴充 users.team CHECK：加入「管理部」
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_team_check;

ALTER TABLE users ADD CONSTRAINT users_team_check CHECK (team IN (
  -- 業務部門
  '業一課', '業二課', '專案課', '電商課',
  -- 管理與其他
  '管理員', '業務部', '報關部',
  '管理部',  -- 新增：管理部（行政管理部門，與「管理員」區別）
  -- 物流部 (含子課)
  '物流一部', '物流二部',
  '物流一部遠洋課', '物流一部大陸課', '物流一部大陸進口課',
  '物流二部空運課', '物流二部三角課',
  -- 關係企業
  '崧盛'
));

-- 註：本次僅放寬 CHECK 約束，未授予 finance / hr 任何特殊權限。
--     若日後要讓 hr 可看邏輯測試結果，需要修改 is_hr_role() 函式
--     （migrations/019_assessment_events_submissions.sql）。
