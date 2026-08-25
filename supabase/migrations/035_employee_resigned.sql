-- =============================================
-- Migration 035: 員工離職歸檔
-- 請在 Supabase SQL Editor 中執行此檔案
-- =============================================
--
-- 讓「刪除」改為軟性「離職歸檔」：
--   resigned_at IS NULL      → 在職（顯示在名冊）
--   resigned_at IS NOT NULL  → 已離職（歸檔到「離職員工」清單，可復職或永久刪除）
--
-- 保留員工過往測驗紀錄與連結，離職不影響歷史資料。

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS resigned_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_employees_resigned ON employees(resigned_at);

-- RLS 沿用 025 的 can_manage_employees()（UPDATE / DELETE 皆已涵蓋），無需新增政策。
