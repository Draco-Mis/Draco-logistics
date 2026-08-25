-- =============================================
-- Migration 006: 產業類別從 4 類擴充為 12 類
-- 請在 Supabase SQL Editor 中執行此檔案
-- 執行前建議先備份 customers 表
-- =============================================

-- 1. 移除舊的 CHECK 約束（支援 migration 005 原本的 4 類）
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_industry_check;

-- 2. 新增 12 類 CHECK 約束
ALTER TABLE customers ADD CONSTRAINT customers_industry_check
CHECK (industry IN (
  '電子科技業', '機械製造業', '化工原物料', '紡織成衣業',
  '食品飲料業', '醫療保健業', '汽車零組件', '貿易進出口',
  '電商零售業', '建材五金業', '能源環保業', '其他'
));

-- 注意：若資料庫已有舊值（製造業、貿易業、服務業），
-- 新增約束前會失敗。請先執行以下語句遷移舊值：
-- UPDATE customers SET industry = '機械製造業' WHERE industry = '製造業';
-- UPDATE customers SET industry = '貿易進出口' WHERE industry = '貿易業';
-- UPDATE customers SET industry = '其他'       WHERE industry = '服務業';
