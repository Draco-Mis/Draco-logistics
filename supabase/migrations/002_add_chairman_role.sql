-- =====================================================
-- Migration: 新增 chairman（董事長）角色
-- 董事長：看所有客戶、審轉移、管理使用者，但不能看報表/PP&E/匯入
-- =====================================================

-- 1. 放寬 users.role 的 CHECK 允許 chairman
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'chairman', 'manager', 'sales'));

-- 2. 更新現有的 RLS 政策：把 chairman 視為 admin 等級
-- customers: chairman 可更新任何客戶（和 admin/manager 一樣）
DROP POLICY IF EXISTS "customers_update" ON customers;
CREATE POLICY "customers_update" ON customers FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'chairman', 'manager'))
    OR
    (assigned_to = auth.uid() AND status IN ('active_developing', 'warning'))
  );

-- transfer_requests: chairman 可審核
DROP POLICY IF EXISTS "transfer_requests_update" ON transfer_requests;
CREATE POLICY "transfer_requests_update" ON transfer_requests FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'chairman', 'manager'))
  );

-- users: chairman 可管理使用者（和 admin 一樣）
DROP POLICY IF EXISTS "users_admin_all" ON users;
CREATE POLICY "users_admin_all" ON users FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'chairman'))
  );

-- 3. 把 Anna 角色改為 chairman
UPDATE users SET role = 'chairman' WHERE email = 'anna@dracolog.com';
