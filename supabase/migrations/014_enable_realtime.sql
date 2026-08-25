-- =============================================
-- Migration 014: 啟用 Supabase Realtime publication
-- =============================================
-- 把 customers / customer_history / comments / customer_contacts 加入
-- supabase_realtime publication，前端就能用 WebSocket 訂閱這些表的變動：
--   - INSERT：別人新增客戶 → 列表頁即時刷新
--   - UPDATE：別人改狀態、改聯絡資料 → 詳情頁即時反映
--   - DELETE：硬刪除事件（軟刪除是 UPDATE，受 RLS 過濾不會送達 → 需手動重整）
--
-- 注意：Realtime 仍受 RLS 政策約束，使用者只會收到「自己有 SELECT 權限的 row」事件。
-- =============================================

-- 安全地加入 publication（如果已加過會跳過）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'customers'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE customers;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'customer_history'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE customer_history;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'comments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE comments;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'customer_contacts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE customer_contacts;
  END IF;
END $$;
