-- =============================================
-- 登泰國際 CRM 資料庫 Schema
-- 請在 Supabase SQL Editor 中執行此檔案
-- =============================================

-- 1. Users 資料表
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  chinese_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'sales')),
  team TEXT NOT NULL CHECK (team IN ('業一課', '業二課', '專案課')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  telegram_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Customers 資料表
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name TEXT NOT NULL,
  company_code TEXT,
  company_code_type TEXT CHECK (company_code_type IN ('上市', '上櫃', '興櫃', '一般公司')),
  assigned_to UUID NOT NULL REFERENCES users(id),
  created_date DATE NOT NULL DEFAULT CURRENT_DATE,
  last_contact_date DATE,
  status TEXT NOT NULL DEFAULT 'active_developing' CHECK (status IN ('active_developing', 'warning', 'locked', 'reactivating')),
  grade TEXT NOT NULL CHECK (grade IN ('A', 'B', 'C')),
  created_by UUID NOT NULL REFERENCES users(id),
  locked_at TIMESTAMPTZ,
  locked_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for search and filtering
CREATE INDEX idx_customers_company_name ON customers USING gin (company_name gin_trgm_ops);
CREATE INDEX idx_customers_status ON customers(status);
CREATE INDEX idx_customers_assigned_to ON customers(assigned_to);
CREATE INDEX idx_customers_grade ON customers(grade);
CREATE INDEX idx_customers_created_date ON customers(created_date);

-- 3. Customer History 資料表
CREATE TABLE IF NOT EXISTS customer_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL CHECK (action_type IN ('created', 'warning', 'locked', 'transfer_requested', 'transfer_approved', 'reactivated')),
  action_by UUID NOT NULL REFERENCES users(id),
  action_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  from_user UUID REFERENCES users(id),
  to_user UUID REFERENCES users(id),
  note TEXT
);

CREATE INDEX idx_customer_history_customer_id ON customer_history(customer_id);

-- 4. Comments 資料表
CREATE TABLE IF NOT EXISTS comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_comments_customer_id ON comments(customer_id);

-- 5. Transfer Requests 資料表
CREATE TABLE IF NOT EXISTS transfer_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES users(id),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  note TEXT
);

CREATE INDEX idx_transfer_requests_status ON transfer_requests(status);
CREATE INDEX idx_transfer_requests_customer_id ON transfer_requests(customer_id);

-- 6. Notifications 資料表（用於站內通知）
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_is_read ON notifications(is_read);

-- =============================================
-- Enable pg_trgm extension for fuzzy search
-- =============================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- =============================================
-- Row Level Security (RLS)
-- =============================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfer_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Users: everyone can read, only admin can modify
CREATE POLICY "users_select" ON users FOR SELECT TO authenticated USING (true);
CREATE POLICY "users_admin_all" ON users FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin')
  );

-- Customers: everyone can read, write rules based on role
CREATE POLICY "customers_select" ON customers FOR SELECT TO authenticated USING (true);
CREATE POLICY "customers_insert" ON customers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "customers_update" ON customers FOR UPDATE TO authenticated
  USING (
    -- Admin can update any
    EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'manager'))
    OR
    -- Sales can update own active/warning customers
    (assigned_to = auth.uid() AND status IN ('active_developing', 'warning'))
  );

-- Customer History: everyone can read, insert
CREATE POLICY "customer_history_select" ON customer_history FOR SELECT TO authenticated USING (true);
CREATE POLICY "customer_history_insert" ON customer_history FOR INSERT TO authenticated WITH CHECK (true);

-- Comments: everyone can read and insert
CREATE POLICY "comments_select" ON comments FOR SELECT TO authenticated USING (true);
CREATE POLICY "comments_insert" ON comments FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- Transfer Requests: everyone can read, specific insert/update rules
CREATE POLICY "transfer_requests_select" ON transfer_requests FOR SELECT TO authenticated USING (true);
CREATE POLICY "transfer_requests_insert" ON transfer_requests FOR INSERT TO authenticated WITH CHECK (requested_by = auth.uid());
CREATE POLICY "transfer_requests_update" ON transfer_requests FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'manager'))
  );

-- Notifications: users can only see their own
CREATE POLICY "notifications_select" ON notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "notifications_insert" ON notifications FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "notifications_update" ON notifications FOR UPDATE TO authenticated USING (user_id = auth.uid());
