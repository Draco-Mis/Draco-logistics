-- =====================================================
-- Migration: 新增「已成交」相關狀態
-- 新狀態：negotiating（洽談中）、completed（已成交）、
--        long_term（長期合作）、abandoned（未成交/放棄）
-- =====================================================

-- 1. 放寬 customers.status 的 CHECK
ALTER TABLE customers
  DROP CONSTRAINT IF EXISTS customers_status_check;

ALTER TABLE customers
  ADD CONSTRAINT customers_status_check
  CHECK (status IN (
    'active_developing',
    'negotiating',
    'completed',
    'long_term',
    'abandoned',
    'warning',
    'locked',
    'reactivating'
  ));

-- 2. 放寬 customer_history.action_type 加入新的標記事件
ALTER TABLE customer_history
  DROP CONSTRAINT IF EXISTS customer_history_action_type_check;

ALTER TABLE customer_history
  ADD CONSTRAINT customer_history_action_type_check
  CHECK (action_type IN (
    'created',
    'notify_30',
    'notify_60',
    'warning',
    'notify_80',
    'locked',
    'transfer_requested',
    'transfer_approved',
    'reactivated',
    'mark_negotiating',
    'mark_completed',
    'mark_long_term',
    'mark_abandoned',
    'mark_developing'
  ));

-- 3. 放寬 customers UPDATE 的 RLS：允許負責業務更新自己的客戶
--    （不只 active_developing/warning，擴充為除了 locked 之外的所有狀態）
DROP POLICY IF EXISTS "customers_update" ON customers;
CREATE POLICY "customers_update" ON customers FOR UPDATE TO authenticated
  USING (
    -- admin / chairman / manager 可更新任何客戶
    EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'chairman', 'manager'))
    OR
    -- 一般業務可更新自己負責、且非鎖檔的客戶（包含洽談中/已成交/長期合作/未成交）
    (assigned_to = auth.uid() AND status <> 'locked')
  );
