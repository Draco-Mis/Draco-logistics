-- 限制「客戶聯絡資訊 / 歷史軌跡 / 留言」的檢視權限
--
-- 規則：
--   admin / chairman / director → 全部客戶皆可看
--   manager                    → 僅可看「負責業務與自己同課別」的客戶
--   其他（sales 等）           → 僅可看「目前負責業務是自己」的客戶
--
-- 負責業務轉移後，舊業務的 auth.uid() 不再等於 customers.assigned_to，
-- 因此自動失去對該客戶聯絡人/歷史/留言的讀取權限。

-- 1. 確保 customer_contacts 已開啟 RLS（此表由 Supabase UI 建立，未包含在 schema.sql）
ALTER TABLE customer_contacts ENABLE ROW LEVEL SECURITY;

-- 2. 建立權限判斷函式
--    SECURITY DEFINER 讓函式能在 RLS 政策內安全查詢 users / customers，
--    避免遞迴觸發其他 RLS。
CREATE OR REPLACE FUNCTION can_view_customer_detail(p_customer_id UUID)
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
        OR c.assigned_to = auth.uid()
        OR (me.role = 'manager' AND me.team = assigned.team)
      )
  );
$$;

-- 3. 套用到三張表的 SELECT 政策（先移除舊的，再建立新的）
DROP POLICY IF EXISTS "customer_history_select"  ON customer_history;
DROP POLICY IF EXISTS "comments_select"          ON comments;
DROP POLICY IF EXISTS "customer_contacts_select" ON customer_contacts;

CREATE POLICY "customer_history_select" ON customer_history
  FOR SELECT TO authenticated
  USING (can_view_customer_detail(customer_id));

CREATE POLICY "comments_select" ON comments
  FOR SELECT TO authenticated
  USING (can_view_customer_detail(customer_id));

CREATE POLICY "customer_contacts_select" ON customer_contacts
  FOR SELECT TO authenticated
  USING (can_view_customer_detail(customer_id));

-- 注意：INSERT / UPDATE / DELETE 政策維持原樣未動。
-- 目前 UI 已透過 canEdit 擋住未授權使用者執行寫入動作。
-- 若需一併收緊寫入權限，另寫 migration。
