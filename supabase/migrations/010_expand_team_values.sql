-- =============================================
-- Migration 010: 擴充 users.team CHECK 約束
-- 新增物流部子課與關係企業「崧盛」
-- 請在 Supabase SQL Editor 中執行此檔案
-- =============================================

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_team_check;

ALTER TABLE users ADD CONSTRAINT users_team_check CHECK (team IN (
  -- 業務部門
  '業一課', '業二課', '專案課', '電商課',
  -- 管理與其他
  '管理員', '業務部', '報關部',
  -- 物流部 (含子課)
  '物流一部', '物流二部',
  '物流一部遠洋課', '物流一部大陸課', '物流一部大陸進口課',
  '物流二部空運課', '物流二部三角課',
  -- 關係企業
  '崧盛'
));
