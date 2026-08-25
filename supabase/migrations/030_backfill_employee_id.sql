-- =============================================
-- Migration 030: 把既有測驗結果自動歸檔到員工名冊
-- 透過中文姓名比對，把 assessment_submissions.hired_employee_id 連結到對應的員工
-- =============================================

UPDATE assessment_submissions s
SET hired_employee_id = e.id
FROM employees e
WHERE s.hired_employee_id IS NULL
  AND s.respondent_name = e.chinese_name;

-- 驗證
SELECT
  COUNT(*) FILTER (WHERE hired_employee_id IS NOT NULL) AS linked,
  COUNT(*) FILTER (WHERE hired_employee_id IS NULL) AS unlinked,
  COUNT(*) AS total
FROM assessment_submissions;
