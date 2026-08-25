-- =============================================
-- Migration 037: 員工名冊新增「單位」欄位
-- 請在 Supabase SQL Editor 中執行此檔案
-- =============================================
--
-- 員工名冊原本有 職稱(title) 與 分類(category)，但沒有「單位/部門」。
-- 新增 unit 欄位讓 HR 可以標記每位員工所屬單位（例如 業務部 / 物流部 / 報關部）。
-- 自由文字，前端以建議清單輔助輸入。

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS unit TEXT;
