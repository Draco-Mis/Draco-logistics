-- =====================================================
-- Migration: 允許使用者刪除自己的通知
-- =====================================================

CREATE POLICY "notifications_delete" ON notifications FOR DELETE TO authenticated
  USING (user_id = auth.uid());
