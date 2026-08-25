-- =============================================
-- Migration 011: 收緊 customer_contacts 寫入權限
-- =============================================
-- 規則：
--   admin / chairman / director → 全部聯絡人皆可新增/編輯/刪除
--   manager                    → 僅可管理「客戶目前負責業務與自己同課別」的聯絡人
--   sales / 其他               → 僅 SELECT（讀取受 migration 007 限制），不可寫入
--
-- 與 migration 008（customers UPDATE）、009（transfer_requests UPDATE）的 manager
-- 同課別規則一致。前端 ContactsSection 已透過 isSuperRole 把按鈕擋掉，本 migration
-- 是 server 端最後一道防線，避免直接打 PostgREST API 繞過 UI 寫入。
--
-- 注意：SELECT 政策維持 migration 007 的 can_view_customer_detail() 函式，未動。
-- =============================================

-- 1. 確保 customer_contacts 已開啟 RLS（migration 007 已開過，再 enable 是 idempotent）
ALTER TABLE customer_contacts ENABLE ROW LEVEL SECURITY;

-- 2. 建立寫入權限判斷函式
--    SECURITY DEFINER 讓函式能在 RLS 政策內安全查詢 users / customers，
--    避免遞迴觸發其他 RLS。
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
      )
  );
$$;

-- 3. 套用三個寫入政策（先移除舊的，再建立新的）
DROP POLICY IF EXISTS "customer_contacts_insert" ON customer_contacts;
DROP POLICY IF EXISTS "customer_contacts_update" ON customer_contacts;
DROP POLICY IF EXISTS "customer_contacts_delete" ON customer_contacts;

CREATE POLICY "customer_contacts_insert" ON customer_contacts
  FOR INSERT TO authenticated
  WITH CHECK (can_manage_customer_contact(customer_id));

CREATE POLICY "customer_contacts_update" ON customer_contacts
  FOR UPDATE TO authenticated
  USING (can_manage_customer_contact(customer_id))
  WITH CHECK (can_manage_customer_contact(customer_id));

CREATE POLICY "customer_contacts_delete" ON customer_contacts
  FOR DELETE TO authenticated
  USING (can_manage_customer_contact(customer_id));
