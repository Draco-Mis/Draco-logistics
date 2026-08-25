-- =============================================
-- Migration 019: 邏輯思維評估 — 活動 + 提交紀錄
-- =============================================
-- 兩張表：
--   - assessment_events：HR 建立的測驗活動（含公開連結 code）
--   - assessment_submissions：受測者的作答紀錄（公開 INSERT，限 admin/director SELECT）
-- 沿用 SECURITY DEFINER function RLS 模式
-- =============================================

-- 1. assessment_events
CREATE TABLE IF NOT EXISTS assessment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  test_types JSONB NOT NULL DEFAULT '["logic"]'::jsonb,
  deadline TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assessment_events_code ON assessment_events(code);
CREATE INDEX IF NOT EXISTS idx_assessment_events_active ON assessment_events(is_active, deadline);

-- 2. assessment_submissions
CREATE TABLE IF NOT EXISTS assessment_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES assessment_events(id) ON DELETE CASCADE,
  respondent_name TEXT NOT NULL,
  department TEXT NOT NULL,
  employee_code TEXT,
  version TEXT NOT NULL CHECK (version IN ('A','B','C','D','E')),
  logic_answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  logic_scores JSONB,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  ip_address VARCHAR(45)
);

CREATE INDEX IF NOT EXISTS idx_assessment_subs_event ON assessment_submissions(event_id);
CREATE INDEX IF NOT EXISTS idx_assessment_subs_status ON assessment_submissions(status);
CREATE INDEX IF NOT EXISTS idx_assessment_subs_completed_at ON assessment_submissions(completed_at) WHERE status = 'completed';

-- 防重複：同一活動 + 姓名 + 部門 只能存在一筆 completed
CREATE UNIQUE INDEX IF NOT EXISTS idx_assessment_subs_unique_completed
  ON assessment_submissions(event_id, respondent_name, department)
  WHERE status = 'completed';

-- 3. RLS：events
ALTER TABLE assessment_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION is_hr_role()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
      AND is_active = true
      AND role IN ('admin', 'director')
  );
$$;

GRANT EXECUTE ON FUNCTION is_hr_role() TO authenticated;

DROP POLICY IF EXISTS "assessment_events_select" ON assessment_events;
CREATE POLICY "assessment_events_select" ON assessment_events FOR SELECT TO authenticated
  USING (is_hr_role());

DROP POLICY IF EXISTS "assessment_events_insert" ON assessment_events;
CREATE POLICY "assessment_events_insert" ON assessment_events FOR INSERT TO authenticated
  WITH CHECK (is_hr_role());

DROP POLICY IF EXISTS "assessment_events_update" ON assessment_events;
CREATE POLICY "assessment_events_update" ON assessment_events FOR UPDATE TO authenticated
  USING (is_hr_role())
  WITH CHECK (is_hr_role());

-- 4. RLS：submissions
-- 公開 INSERT（給 /assess/[code] 受測者）：anon + authenticated 都可
-- SELECT 僅限 HR
-- UPDATE 僅限 HR（受測者的續答都走 server-side service_role 路徑，不直連）
ALTER TABLE assessment_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "assessment_subs_select" ON assessment_submissions;
CREATE POLICY "assessment_subs_select" ON assessment_submissions FOR SELECT TO authenticated
  USING (is_hr_role());

DROP POLICY IF EXISTS "assessment_subs_insert" ON assessment_submissions;
CREATE POLICY "assessment_subs_insert" ON assessment_submissions FOR INSERT TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "assessment_subs_update" ON assessment_submissions;
CREATE POLICY "assessment_subs_update" ON assessment_submissions FOR UPDATE TO authenticated
  USING (is_hr_role())
  WITH CHECK (is_hr_role());

-- 註：受測者進入 /assess/[code] 時，所有讀寫都走 Next.js API route + service_role 寫入，
--    不會直接透過 anon supabase 客戶端打 PostgREST。anon INSERT policy 只是 fallback。
