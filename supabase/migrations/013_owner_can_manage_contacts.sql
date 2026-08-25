-- =============================================
-- Migration 013: 放寬聯絡人寫入權限：負責業務本人可管理自己客戶的聯絡人
-- =============================================
-- 沿用 migration 011 的 can_manage_customer_contact() 函式，加上一個 OR 條件：
--   c.assigned_to = auth.uid() AND c.status <> 'locked'
-- 即「客戶的負責業務本人，在客戶非鎖檔狀態下，可以管理該客戶的聯絡人」。
--
-- 規則總表：
--   admin / chairman / director → 全部聯絡人皆可
--   manager                    → 同課別負責的客戶
--   負責業務本人（任何 role）   → 自己負責、非鎖檔的客戶  ← 本 migration 新增
--   其他                       → 不可
--
-- 與 migration 008（customers UPDATE：自己負責且非 locked 可改）規則一致。
-- =============================================

CREATE OR REPLACE FUNCTION can_manage_customer_contact(p_customer_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM users me
    JOIN customers c ON c.id = p_customer_id
    LEFT JOIN users assigned ON assigned.id = c.assigned_to
    WHERE me.id = auth.uid()
      AND (
        me.role IN ('admin', 'chairman', 'director')
        OR (me.role = 'manager' AND me.team = assigned.team)
        OR (c.assigned_to = auth.uid() AND c.status <> 'locked')
      )
  );
$$;
