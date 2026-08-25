-- =============================================
-- Migration 023: assessment_submissions 加 AI 性向分析欄位
-- 請在 Supabase SQL Editor 中執行此檔案
-- =============================================

ALTER TABLE assessment_submissions
  ADD COLUMN IF NOT EXISTS ai_profile TEXT,
  ADD COLUMN IF NOT EXISTS ai_profile_generated_at TIMESTAMPTZ;

-- 註：兩個欄位 nullable。HR 在後台手動點「生成性向分析」按鈕才會填值。
--     重新生成會覆蓋既有內容。
