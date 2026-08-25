-- =============================================
-- Migration 027: 面試人員測驗（kind 欄位 + 錄取歸檔欄位）
-- 請在 Supabase SQL Editor 中執行此檔案
-- =============================================
--
-- 1. assessment_events.kind：區分「員工測驗」與「面試人員測驗」
-- 2. assessment_submissions：加上錄取狀態 + 連到 employees 名冊的 FK

-- 1. 活動類型
ALTER TABLE assessment_events
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'employee';

ALTER TABLE assessment_events
  DROP CONSTRAINT IF EXISTS assessment_events_kind_check;

ALTER TABLE assessment_events
  ADD CONSTRAINT assessment_events_kind_check
  CHECK (kind IN ('employee', 'interview'));

-- 2a. 錄取時間（null = 尚未錄取 / 不適用）
ALTER TABLE assessment_submissions
  ADD COLUMN IF NOT EXISTS hired_at TIMESTAMPTZ DEFAULT NULL;

-- 2b. 已加入員工名冊後的 FK
ALTER TABLE assessment_submissions
  ADD COLUMN IF NOT EXISTS hired_employee_id UUID
  REFERENCES employees(id) ON DELETE SET NULL;

-- 2c. HR 備註（例如「2026 春季招募」「等待報到」等）
ALTER TABLE assessment_submissions
  ADD COLUMN IF NOT EXISTS hire_notes TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_assessment_submissions_hired
  ON assessment_submissions(hired_at)
  WHERE hired_at IS NOT NULL;
