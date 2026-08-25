-- =============================================
-- Migration 039: 客戶刪除審核工作流
-- 請在 Supabase SQL Editor 中執行此檔案
-- =============================================
--
-- 需求：業務可自行「申請刪除」客戶，但要送「該課課長」審核；
--       課長核准後客戶才真正從名單移除（軟刪除）。admin 仍可直接刪除。
--
-- 設計（對齊既有的 transfer 審核）：
--   - customer_deletion_requests 記錄申請
--   - request_customer_deletion  ：建立申請（可編輯該客戶者）→ 通知課長 + admin
--   - review_customer_deletion   ：課長(同課) / admin / 部長 / 董事長 核准或拒絕
--     核准 → 軟刪除客戶 + 寫稽核 + 通知申請人（全在單一交易內）

CREATE TABLE IF NOT EXISTS customer_deletion_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES users(id),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_deletion_requests_status ON customer_deletion_requests(status);
CREATE INDEX IF NOT EXISTS idx_deletion_requests_customer ON customer_deletion_requests(customer_id);
-- 同一客戶同時只允許一筆 pending
CREATE UNIQUE INDEX IF NOT EXISTS idx_deletion_requests_one_pending
  ON customer_deletion_requests(customer_id) WHERE status = 'pending';

ALTER TABLE customer_deletion_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deletion_requests_select" ON customer_deletion_requests;
CREATE POLICY "deletion_requests_select" ON customer_deletion_requests
  FOR SELECT TO authenticated USING (true);

-- 寫入一律走 RPC（SECURITY DEFINER），不開放直接 insert/update

-- =============================================
-- RPC 1：申請刪除
-- =============================================
CREATE OR REPLACE FUNCTION request_customer_deletion(
  p_customer_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_caller_role TEXT;
  v_caller_team TEXT;
  v_caller_active BOOLEAN;
  v_caller_name TEXT;
  v_customer_name TEXT;
  v_owner UUID;
  v_owner_team TEXT;
  v_req_id UUID;
BEGIN
  SELECT role::text, team::text, is_active, COALESCE(chinese_name, name)
    INTO v_caller_role, v_caller_team, v_caller_active, v_caller_name
  FROM users WHERE id = v_caller_id;

  IF v_caller_id IS NULL THEN RAISE EXCEPTION '未登入' USING ERRCODE = '42501'; END IF;
  IF v_caller_active IS NOT TRUE THEN RAISE EXCEPTION '帳號已停用' USING ERRCODE = '42501'; END IF;

  SELECT c.company_name, c.assigned_to, u.team::text
    INTO v_customer_name, v_owner, v_owner_team
  FROM customers c LEFT JOIN users u ON u.id = c.assigned_to
  WHERE c.id = p_customer_id AND c.deleted_at IS NULL;

  IF v_customer_name IS NULL THEN RAISE EXCEPTION '客戶不存在或已刪除' USING ERRCODE = '02000'; END IF;

  -- 可申請者：負責業務本人 / 同課課長 / admin / 部長 / 董事長
  IF NOT (
    v_owner = v_caller_id
    OR v_caller_role IN ('admin', 'chairman', 'director')
    OR (v_caller_role = 'manager' AND v_owner_team IS NOT NULL AND v_owner_team = v_caller_team)
  ) THEN
    RAISE EXCEPTION '你沒有權限申請刪除此客戶' USING ERRCODE = '42501';
  END IF;

  -- 已有 pending → 擋掉
  IF EXISTS (SELECT 1 FROM customer_deletion_requests WHERE customer_id = p_customer_id AND status = 'pending') THEN
    RAISE EXCEPTION '此客戶已有待審核的刪除申請' USING ERRCODE = '23505';
  END IF;

  INSERT INTO customer_deletion_requests (customer_id, requested_by, reason)
  VALUES (p_customer_id, v_caller_id, NULLIF(TRIM(COALESCE(p_reason, '')), ''))
  RETURNING id INTO v_req_id;

  -- 通知：同課課長 + 所有 admin（排除申請人自己）
  INSERT INTO notifications (user_id, title, message, link)
  SELECT u.id,
         '客戶刪除待審核',
         format('%s 申請刪除客戶「%s」，請審核', COALESCE(v_caller_name, '某業務'), v_customer_name),
         '/transfers'
  FROM users u
  WHERE u.is_active = true
    AND u.id <> v_caller_id
    AND (
      u.role = 'admin'
      OR (u.role = 'manager' AND v_owner_team IS NOT NULL AND u.team::text = v_owner_team)
    );

  RETURN json_build_object('success', true, 'request_id', v_req_id, 'company_name', v_customer_name);
END;
$$;

GRANT EXECUTE ON FUNCTION request_customer_deletion(UUID, TEXT) TO authenticated;

-- =============================================
-- RPC 2：審核刪除
-- =============================================
CREATE OR REPLACE FUNCTION review_customer_deletion(
  p_request_id UUID,
  p_approved BOOLEAN
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_caller_role TEXT;
  v_caller_team TEXT;
  v_caller_active BOOLEAN;
  v_caller_name TEXT;
  v_req RECORD;
  v_customer_name TEXT;
  v_owner_team TEXT;
BEGIN
  SELECT role::text, team::text, is_active, COALESCE(chinese_name, name)
    INTO v_caller_role, v_caller_team, v_caller_active, v_caller_name
  FROM users WHERE id = v_caller_id;

  IF v_caller_id IS NULL THEN RAISE EXCEPTION '未登入' USING ERRCODE = '42501'; END IF;
  IF v_caller_active IS NOT TRUE THEN RAISE EXCEPTION '帳號已停用' USING ERRCODE = '42501'; END IF;

  SELECT * INTO v_req FROM customer_deletion_requests WHERE id = p_request_id FOR UPDATE;
  IF v_req.id IS NULL THEN RAISE EXCEPTION '找不到此刪除申請' USING ERRCODE = '02000'; END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION '此申請已被審核過（目前狀態：%）', v_req.status USING ERRCODE = '22023';
  END IF;

  SELECT c.company_name, u.team::text INTO v_customer_name, v_owner_team
  FROM customers c LEFT JOIN users u ON u.id = c.assigned_to
  WHERE c.id = v_req.customer_id;

  -- 審核權：admin / 董事長 / 部長 全部；課長僅限同課
  IF v_caller_role IN ('admin', 'chairman', 'director') THEN
    NULL;
  ELSIF v_caller_role = 'manager' AND v_owner_team IS NOT NULL AND v_owner_team = v_caller_team THEN
    NULL;
  ELSE
    RAISE EXCEPTION '你沒有權限審核此刪除申請' USING ERRCODE = '42501';
  END IF;

  UPDATE customer_deletion_requests
  SET status = CASE WHEN p_approved THEN 'approved' ELSE 'rejected' END,
      reviewed_by = v_caller_id, reviewed_at = now()
  WHERE id = p_request_id;

  IF p_approved THEN
    UPDATE customers SET deleted_at = now() WHERE id = v_req.customer_id AND deleted_at IS NULL;
    INSERT INTO customer_history (customer_id, action_type, action_by, note)
    VALUES (v_req.customer_id, 'deleted', v_caller_id,
            format('刪除申請經 %s 核准，客戶已移除', COALESCE(v_caller_name, '審核者')));
  END IF;

  -- 通知申請人
  INSERT INTO notifications (user_id, title, message, link)
  VALUES (
    v_req.requested_by,
    CASE WHEN p_approved THEN '刪除申請已核准' ELSE '刪除申請已拒絕' END,
    format('你對「%s」的刪除申請已%s', v_customer_name, CASE WHEN p_approved THEN '核准，客戶已移除' ELSE '被拒絕' END),
    CASE WHEN p_approved THEN '/customers' ELSE format('/customers/%s', v_req.customer_id) END
  );

  RETURN json_build_object('success', true, 'approved', p_approved, 'company_name', v_customer_name);
END;
$$;

GRANT EXECUTE ON FUNCTION review_customer_deletion(UUID, BOOLEAN) TO authenticated;
