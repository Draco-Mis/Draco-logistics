-- =============================================
-- Migration 041: 主管推薦優先開發
-- 請在 Supabase SQL Editor 中執行此檔案
-- =============================================
--
-- 主管可在客戶詳情頁把客戶標記為「建議優先開發」+ 備註；
-- 被標記的客戶會在業務的「我的客戶」與客戶列表中優先列在最前面。
-- 權限沿用 customers 既有 UPDATE 政策（admin/部長/董事長全部；課長同課）。

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS priority_flag BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS priority_note TEXT,
  ADD COLUMN IF NOT EXISTS priority_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS priority_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_customers_priority ON customers(priority_flag) WHERE priority_flag = true;
