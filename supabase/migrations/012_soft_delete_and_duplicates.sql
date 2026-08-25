-- =============================================
-- Migration 012: 客戶軟刪除 + 重複偵測 RPC
-- 1. customers 加 deleted_at 欄位（NULL = 仍存在）
-- 2. 部分索引（只索引未刪除的 row）
-- 3. customers SELECT policy 改為自動過濾已刪除（client 端 SDK 透過 RLS 自動隔離；
--    cron 用 service_role 會 bypass RLS，必須在程式端顯式 .is('deleted_at', null)）
-- 4. customer_history.action_type CHECK 加入 'deleted'
-- 5. find_similar_customers RPC：用 pg_trgm 找出疑似重複（相似度 >= threshold）
-- =============================================

-- 1. 加欄位
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- 2. 部分索引（只索引已軟刪除的 row，加速「列出已刪除」查詢且不增加 live 查詢成本）
CREATE INDEX IF NOT EXISTS idx_customers_deleted_at
  ON customers(deleted_at)
  WHERE deleted_at IS NOT NULL;

-- 3. 改寫 SELECT policy：未刪除才可見（admin 也一樣，目前無還原 UI）
DROP POLICY IF EXISTS "customers_select" ON customers;
CREATE POLICY "customers_select" ON customers FOR SELECT TO authenticated
  USING (deleted_at IS NULL);

-- 4. customer_history.action_type 加入 'deleted'
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
    'mark_developing',
    'deleted'
  ));

-- 5. RPC：找出疑似重複客戶（pg_trgm 相似度比對）
-- 使用 GIN trigram 索引 + % 運算子篩選候選對，再用 similarity() 計算精確分數
-- 回傳每一對相似客戶（id_a < id_b 避免重複組合）
CREATE OR REPLACE FUNCTION find_similar_customers(threshold REAL DEFAULT 0.6)
RETURNS TABLE(
  id_a UUID,
  id_b UUID,
  name_a TEXT,
  name_b TEXT,
  sim REAL
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a.id AS id_a,
    b.id AS id_b,
    a.company_name AS name_a,
    b.company_name AS name_b,
    similarity(a.company_name, b.company_name) AS sim
  FROM customers a
  JOIN customers b
    ON a.id < b.id
   AND a.company_name % b.company_name
  WHERE a.deleted_at IS NULL
    AND b.deleted_at IS NULL
    AND similarity(a.company_name, b.company_name) >= threshold
  ORDER BY similarity(a.company_name, b.company_name) DESC
  LIMIT 500;
$$;

GRANT EXECUTE ON FUNCTION find_similar_customers(REAL) TO authenticated;

-- =============================================
-- 使用說明
-- 套用後：
--   - 所有 client 端 supabase.from('customers').select() 自動只取 deleted_at IS NULL
--   - cron / service_role 程式需顯式 .is('deleted_at', null)
--   - 軟刪除：UPDATE customers SET deleted_at = NOW() WHERE id = ...
--   - 重複偵測：supabase.rpc('find_similar_customers', { threshold: 0.6 })
-- =============================================
