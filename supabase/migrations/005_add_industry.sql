-- =============================================
-- Migration 005: 新增客戶產業類別欄位
-- 請在 Supabase SQL Editor 中執行此檔案
-- =============================================

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS industry TEXT
  CHECK (industry IN ('製造業', '貿易業', '服務業', '其他'));

CREATE INDEX IF NOT EXISTS idx_customers_industry ON customers(industry);
