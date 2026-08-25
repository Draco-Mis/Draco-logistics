-- =============================================
-- Migration 016: users 加 deactivated_at 欄位
-- 紀錄離職時間（誰停用、何時停用）
-- 既有已停用使用者維持 NULL（無法回推）；新停用會自動寫入 NOW()
-- =============================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;

-- 部分索引：方便 /admin/departed 頁面查詢
CREATE INDEX IF NOT EXISTS idx_users_deactivated_at
  ON users(deactivated_at)
  WHERE is_active = false;
