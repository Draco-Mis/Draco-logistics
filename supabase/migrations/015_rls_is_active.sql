-- =============================================
-- Migration 015: 第 4 道防線 — RLS 加上 is_active 檢查
-- =============================================
-- 補上 migration 014 的殘留風險：離職人員若在被停用前已取得 access_token，
-- 仍可在 token 過期前繞過 middleware 直接呼叫 PostgREST API。
--
-- 本 migration 在所有寫入政策與關鍵 SELECT 政策加上 is_active = true 檢查，
-- 讓 RLS 在 DB 層拒絕離職人員的請求，與 middleware / auth-context 形成完整防禦鏈。
--
-- 不動 users_select：避免 auth-context 撈不到自己 row 導致預期外行為。
-- 不動 customer_history_select / comments_select / customer_contacts_select：
-- 這三個透過 can_view_customer_detail() 函式控制，我們改函式即可。
-- =============================================

-- 0. helper：當前 auth 是不是在職使用者
CREATE OR REPLACE FUNCTION is_active_user()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND is_active = true
  );
$$;

GRANT EXECUTE ON FUNCTION is_active_user() TO authenticated;

-- =============================================
-- 1. customers：SELECT / INSERT / UPDATE
-- =============================================

DROP POLICY IF EXISTS "customers_select" ON customers;
CREATE POLICY "customers_select" ON customers FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND is_active_user());

DROP POLICY IF EXISTS "customers_insert" ON customers;
CREATE POLICY "customers_insert" ON customers FOR INSERT TO authenticated
  WITH CHECK (is_active_user());

-- customers_update：保留 migration 008 的角色規則，外層多包一層 is_active_user()
DROP POLICY IF EXISTS "customers_update" ON customers;
CREATE POLICY "customers_update" ON customers FOR UPDATE TO authenticated
  USING (
    is_active_user() AND (
      EXISTS (
        SELECT 1 FROM users u
        WHERE u.id = auth.uid()
          AND u.role IN ('admin', 'chairman', 'director')
      )
      OR
      EXISTS (
        SELECT 1
        FROM users me, users assigned
        WHERE me.id = auth.uid()
          AND me.role = 'manager'
          AND assigned.id = customers.assigned_to
          AND me.team = assigned.team
      )
      OR
      (assigned_to = auth.uid() AND status <> 'locked')
    )
  );

-- =============================================
-- 2. customer_history / comments / transfer_requests：寫入加 is_active
-- =============================================

DROP POLICY IF EXISTS "customer_history_insert" ON customer_history;
CREATE POLICY "customer_history_insert" ON customer_history FOR INSERT TO authenticated
  WITH CHECK (is_active_user());

DROP POLICY IF EXISTS "comments_insert" ON comments;
CREATE POLICY "comments_insert" ON comments FOR INSERT TO authenticated
  WITH CHECK (is_active_user() AND user_id = auth.uid());

DROP POLICY IF EXISTS "transfer_requests_insert" ON transfer_requests;
CREATE POLICY "transfer_requests_insert" ON transfer_requests FOR INSERT TO authenticated
  WITH CHECK (is_active_user() AND requested_by = auth.uid());

-- transfer_requests_update：保留 migration 009 角色規則 + 外包 is_active
DROP POLICY IF EXISTS "transfer_requests_update" ON transfer_requests;
CREATE POLICY "transfer_requests_update" ON transfer_requests FOR UPDATE TO authenticated
  USING (
    is_active_user() AND (
      EXISTS (
        SELECT 1 FROM users u
        WHERE u.id = auth.uid()
          AND u.role IN ('admin', 'chairman', 'director')
      )
      OR
      EXISTS (
        SELECT 1
        FROM users me, customers c, users assigned
        WHERE me.id = auth.uid()
          AND me.role = 'manager'
          AND c.id = transfer_requests.customer_id
          AND assigned.id = c.assigned_to
          AND me.team = assigned.team
      )
    )
  );

-- =============================================
-- 3. 更新 RLS 函式：can_view_customer_detail / can_manage_customer_contact
--    加上 me.is_active = true 條件
--    （sourcing：migration 007 / 011 / 013）
-- =============================================

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
      AND me.is_active = true
      AND (
        me.role IN ('admin', 'chairman', 'director')
        OR c.assigned_to = auth.uid()
        OR (me.role = 'manager' AND me.team = assigned.team)
      )
  );
$$;

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
      AND me.is_active = true
      AND (
        me.role IN ('admin', 'chairman', 'director')
        OR (me.role = 'manager' AND me.team = assigned.team)
        OR (c.assigned_to = auth.uid() AND c.status <> 'locked')
      )
  );
$$;

-- =============================================
-- 4. notifications_insert：維持 WITH CHECK (true)
--    （站內通知主要由 cron / server side 用 service_role 寫入，不受 RLS 影響；
--     極少數 client 直接寫入的場合也是給自己看，無安全疑慮）
-- =============================================
