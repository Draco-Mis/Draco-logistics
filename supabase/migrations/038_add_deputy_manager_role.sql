-- =============================================
-- Migration 038: 新增「副課長」角色 deputy_manager
-- 請在 Supabase SQL Editor 中執行此檔案
-- =============================================
--
-- 副課長可在「業務績效 / 每週報表」看到同課組員的客戶狀況，
-- 但看不到課長（manager）本人名下的客戶（範圍過濾在前端處理）。
--
-- 寫入權限：副課長不在任何 RLS 的 manager 條款內，
-- 因此對客戶的編輯/轉移審核權限與「業務」相同（只能改自己名下、不能審核轉移），
-- 符合「只多開放團隊檢視、不放大寫入權」的原則。

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN (
  'admin',
  'chairman',
  'director',
  'manager',
  'deputy_manager',  -- 新增：副課長
  'sales',
  'finance',
  'hr'
));
