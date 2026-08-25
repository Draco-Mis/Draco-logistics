-- =============================================
-- Migration 024: assessment_events 加「目標員工分類」欄位
-- 請在 Supabase SQL Editor 中執行此檔案
-- =============================================
--
-- 用途：當 HR 建立人才適性評估活動時，可選擇此活動針對哪些員工分類
-- 例如：只給「高階主管」+「經理/課長級」測；或只給「操作/支援」測。
-- 分類定義在 src/data/employees.json，目前有 4 大類：
--   executive / manager / specialist / operations
-- 此欄位為 nullable，舊活動沒填代表「不限分類」（給任何人答都可以）。

ALTER TABLE assessment_events
  ADD COLUMN IF NOT EXISTS target_categories TEXT[] DEFAULT NULL;

COMMENT ON COLUMN assessment_events.target_categories IS
  '目標員工分類陣列（對應 src/data/employees.json 的 category key）。null 表示不限分類。';
