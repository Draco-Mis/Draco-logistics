-- =============================================
-- Migration 018: Big Five 人格測驗（IPIP-50）
-- =============================================
-- 一位 user 一筆 row（status in_progress → completed）。
-- RLS：
--   - sales / manager / chairman：只看／改自己
--   - admin / director：可看全部（HR 角色）
--   - 任何人都不能改別人的紀錄
-- 寫入仍維持 is_active_user() 檢查（migration 015 的離職員工守門）
-- =============================================

-- 1. 資料表
CREATE TABLE IF NOT EXISTS bigfive_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  scores JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_bigfive_user_id ON bigfive_assessments(user_id);
CREATE INDEX IF NOT EXISTS idx_bigfive_status ON bigfive_assessments(status);
CREATE INDEX IF NOT EXISTS idx_bigfive_completed_at ON bigfive_assessments(completed_at) WHERE status = 'completed';

ALTER TABLE bigfive_assessments ENABLE ROW LEVEL SECURITY;

-- 2. HR 可見性 helper（admin / director = HR）
CREATE OR REPLACE FUNCTION can_view_bigfive(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM users me
    WHERE me.id = auth.uid()
      AND me.is_active = true
      AND (
        me.role IN ('admin', 'director')   -- HR 全部可看
        OR me.id = p_user_id               -- 自己
      )
  );
$$;

GRANT EXECUTE ON FUNCTION can_view_bigfive(UUID) TO authenticated;

-- 3. RLS policies
DROP POLICY IF EXISTS "bigfive_select" ON bigfive_assessments;
CREATE POLICY "bigfive_select" ON bigfive_assessments FOR SELECT TO authenticated
  USING (can_view_bigfive(user_id));

-- 寫入：限自己 + 在職
DROP POLICY IF EXISTS "bigfive_insert" ON bigfive_assessments;
CREATE POLICY "bigfive_insert" ON bigfive_assessments FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND is_active_user());

DROP POLICY IF EXISTS "bigfive_update" ON bigfive_assessments;
CREATE POLICY "bigfive_update" ON bigfive_assessments FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND is_active_user())
  WITH CHECK (user_id = auth.uid() AND is_active_user());

-- 不開放 DELETE（離職時 ON DELETE CASCADE 從 users 連動處理）
