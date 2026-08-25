-- =============================================
-- Migration 031: 理想職位人格剖面（Job Profile）
-- HR 自訂某種職位的理想 Big Five 分布，候選人來時計算 fit score
-- =============================================

CREATE TABLE IF NOT EXISTS bigfive_job_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  -- 五大維度的理想等級或百分位（JSONB 結構）
  -- 範例：{ "E": 80, "A": 65, "C": 85, "N": 30, "O": 60 }
  ideal JSONB NOT NULL,
  -- 各維度權重（0-1 之間，總和不強制）
  -- 範例：{ "E": 1, "A": 1, "C": 1.5, "N": 0.5, "O": 1 }
  weights JSONB DEFAULT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bigfive_job_profiles_name ON bigfive_job_profiles(name);

ALTER TABLE bigfive_job_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "job_profiles_select" ON bigfive_job_profiles;
CREATE POLICY "job_profiles_select" ON bigfive_job_profiles FOR SELECT TO authenticated
  USING (can_manage_employees());

DROP POLICY IF EXISTS "job_profiles_insert" ON bigfive_job_profiles;
CREATE POLICY "job_profiles_insert" ON bigfive_job_profiles FOR INSERT TO authenticated
  WITH CHECK (can_manage_employees());

DROP POLICY IF EXISTS "job_profiles_update" ON bigfive_job_profiles;
CREATE POLICY "job_profiles_update" ON bigfive_job_profiles FOR UPDATE TO authenticated
  USING (can_manage_employees()) WITH CHECK (can_manage_employees());

DROP POLICY IF EXISTS "job_profiles_delete" ON bigfive_job_profiles;
CREATE POLICY "job_profiles_delete" ON bigfive_job_profiles FOR DELETE TO authenticated
  USING (can_manage_employees());

-- 預設幾個常見職位剖面（HR 可在 UI 增改刪）
INSERT INTO bigfive_job_profiles (name, description, ideal, weights)
SELECT * FROM (VALUES
  (
    '業務 / Sales',
    '主動拓展、抗壓性強、結交人脈、能在壓力下穩定推進',
    '{"E": 80, "A": 60, "C": 70, "N": 30, "O": 60}'::jsonb,
    '{"E": 1.5, "A": 1.0, "C": 1.0, "N": 1.2, "O": 0.8}'::jsonb
  ),
  (
    'OP / Operations',
    '注重細節、流程穩定、可靠執行、能承受重複性工作',
    '{"E": 45, "A": 70, "C": 85, "N": 35, "O": 50}'::jsonb,
    '{"E": 0.5, "A": 1.0, "C": 1.5, "N": 1.0, "O": 0.5}'::jsonb
  ),
  (
    '主管 / Manager',
    '能領導也能聽取意見、決策穩健、抗壓、樂於發展他人',
    '{"E": 70, "A": 65, "C": 80, "N": 30, "O": 65}'::jsonb,
    '{"E": 1.2, "A": 1.0, "C": 1.2, "N": 1.5, "O": 1.0}'::jsonb
  ),
  (
    '專案 / PM',
    '同時整合多方意見、規劃完整、應變快、跨部門溝通力強',
    '{"E": 70, "A": 75, "C": 80, "N": 35, "O": 70}'::jsonb,
    '{"E": 1.0, "A": 1.2, "C": 1.3, "N": 1.0, "O": 1.0}'::jsonb
  )
) AS v(name, description, ideal, weights)
WHERE NOT EXISTS (SELECT 1 FROM bigfive_job_profiles);
