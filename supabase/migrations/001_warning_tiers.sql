-- =====================================================
-- Migration: 新增 30/60/80 天警示事件類型
-- =====================================================
-- 原本 customer_history.action_type 只允許 5 種值，
-- 現在加入 notify_30 / notify_60 / notify_80 三個新事件
-- =====================================================

ALTER TABLE customer_history
  DROP CONSTRAINT IF EXISTS customer_history_action_type_check;

ALTER TABLE customer_history
  ADD CONSTRAINT customer_history_action_type_check
  CHECK (action_type IN (
    'created',
    'notify_30',
    'notify_60',
    'warning',      -- 原本的 75 天警示
    'notify_80',
    'locked',
    'transfer_requested',
    'transfer_approved',
    'reactivated'
  ));
