-- =============================================
-- Migration 034: Big Five 配對 + 團隊化學作用分析的永久快取
-- 之前生成後只存 component state，刷新頁面就消失。新表永久保存以節省 API
-- =============================================

CREATE TABLE IF NOT EXISTS bigfive_ai_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_type TEXT NOT NULL CHECK (artifact_type IN ('pair', 'team_chemistry')),
  cache_key TEXT NOT NULL UNIQUE,  -- 排序後的 submission_ids（+ event_id 給 team）做 key
  event_id UUID REFERENCES assessment_events(id) ON DELETE CASCADE,
  submission_ids UUID[] NOT NULL,  -- 涉及的受測者 ids
  profile TEXT NOT NULL,
  meta JSONB,  -- 額外資訊（如 scope_label、a/b 姓名等）
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bigfive_artifacts_cache_key ON bigfive_ai_artifacts(cache_key);
CREATE INDEX IF NOT EXISTS idx_bigfive_artifacts_type ON bigfive_ai_artifacts(artifact_type);
CREATE INDEX IF NOT EXISTS idx_bigfive_artifacts_event ON bigfive_ai_artifacts(event_id);

ALTER TABLE bigfive_ai_artifacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bigfive_artifacts_select" ON bigfive_ai_artifacts;
CREATE POLICY "bigfive_artifacts_select" ON bigfive_ai_artifacts FOR SELECT TO authenticated
  USING (can_manage_employees());

DROP POLICY IF EXISTS "bigfive_artifacts_insert" ON bigfive_ai_artifacts;
CREATE POLICY "bigfive_artifacts_insert" ON bigfive_ai_artifacts FOR INSERT TO authenticated
  WITH CHECK (can_manage_employees());

DROP POLICY IF EXISTS "bigfive_artifacts_update" ON bigfive_ai_artifacts;
CREATE POLICY "bigfive_artifacts_update" ON bigfive_ai_artifacts FOR UPDATE TO authenticated
  USING (can_manage_employees()) WITH CHECK (can_manage_employees());

DROP POLICY IF EXISTS "bigfive_artifacts_delete" ON bigfive_ai_artifacts;
CREATE POLICY "bigfive_artifacts_delete" ON bigfive_ai_artifacts FOR DELETE TO authenticated
  USING (can_manage_employees());

NOTIFY pgrst, 'reload schema';
