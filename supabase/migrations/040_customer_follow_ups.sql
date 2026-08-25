-- =============================================
-- Migration 040: 客戶跟進待辦（follow-ups）
-- 請在 Supabase SQL Editor 中執行此檔案
-- =============================================
--
-- 每筆客戶可建立「下一步 + 到期日」待辦；到期會提醒（每日 cron 發通知）。
-- 業務用它管理「今天/這週該跟進誰」。

CREATE TABLE IF NOT EXISTS customer_follow_ups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  due_date DATE,
  is_done BOOLEAN NOT NULL DEFAULT false,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_follow_ups_customer ON customer_follow_ups(customer_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_open ON customer_follow_ups(created_by, is_done, due_date);

ALTER TABLE customer_follow_ups ENABLE ROW LEVEL SECURITY;

-- 檢視：登入者皆可讀（與客戶其他子資料一致）
DROP POLICY IF EXISTS "follow_ups_select" ON customer_follow_ups;
CREATE POLICY "follow_ups_select" ON customer_follow_ups
  FOR SELECT TO authenticated USING (true);

-- 新增：在職使用者，且 created_by 必須是自己
DROP POLICY IF EXISTS "follow_ups_insert" ON customer_follow_ups;
CREATE POLICY "follow_ups_insert" ON customer_follow_ups
  FOR INSERT TO authenticated
  WITH CHECK (is_active_user() AND created_by = auth.uid());

-- 更新 / 刪除：建立者本人（或 admin）
DROP POLICY IF EXISTS "follow_ups_update" ON customer_follow_ups;
CREATE POLICY "follow_ups_update" ON customer_follow_ups
  FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin')
  );

DROP POLICY IF EXISTS "follow_ups_delete" ON customer_follow_ups;
CREATE POLICY "follow_ups_delete" ON customer_follow_ups
  FOR DELETE TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin')
  );
