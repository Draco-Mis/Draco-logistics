-- =============================================
-- Migration 036: 轉移／認領審核用 RPC（把多步驟包成單一交易）
-- =============================================
-- 問題：
--   前端 transfers 頁的 handleReview 依序打了 4~5 個 await
--   （改 transfer_requests → 改 customer → 寫兩筆 history → 發通知），
--   沒有交易保護也沒有錯誤處理。任一步失敗都會留下資料不一致
--   （例如客戶已轉移但沒有稽核軌跡，或核准了卻沒通知申請人）。
--
-- 解法：
--   SECURITY DEFINER 函式 review_transfer_request：
--   1. 函式以擁有者身份執行，內部明確檢查審核權限
--   2. 所有寫入在同一個函式呼叫（單一交易）內完成，全成功或全回滾
--   3. 前端只呼叫 supabase.rpc('review_transfer_request', {...})
--
-- 權限規則（與原前端 canReviewThis 一致）：
--   admin / chairman / director：可審核任何申請
--   manager：僅能審核「客戶目前負責人與自己同課別」的申請
-- =============================================

CREATE OR REPLACE FUNCTION review_transfer_request(
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
  v_current_owner UUID;
  v_owner_team TEXT;
  v_today DATE := (now() AT TIME ZONE 'Asia/Taipei')::date;
BEGIN
  -- 1. 取得呼叫者資料
  SELECT role::text, team::text, is_active, COALESCE(chinese_name, name)
    INTO v_caller_role, v_caller_team, v_caller_active, v_caller_name
  FROM users WHERE id = v_caller_id;

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION '未登入' USING ERRCODE = '42501';
  END IF;
  IF v_caller_active IS NOT TRUE THEN
    RAISE EXCEPTION '帳號已停用，無法審核' USING ERRCODE = '42501';
  END IF;

  -- 2. 鎖定該筆申請（避免併發重複審核），且必須仍為 pending
  SELECT * INTO v_req
  FROM transfer_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF v_req.id IS NULL THEN
    RAISE EXCEPTION '找不到此轉移申請' USING ERRCODE = '02000';
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION '此申請已被審核過（目前狀態：%）', v_req.status USING ERRCODE = '22023';
  END IF;

  -- 3. 取得客戶目前負責人 + 課別
  SELECT c.company_name, c.assigned_to, u.team::text
    INTO v_customer_name, v_current_owner, v_owner_team
  FROM customers c
  LEFT JOIN users u ON u.id = c.assigned_to
  WHERE c.id = v_req.customer_id;

  IF v_customer_name IS NULL THEN
    RAISE EXCEPTION '客戶不存在' USING ERRCODE = '02000';
  END IF;

  -- 4. 權限檢查
  IF v_caller_role IN ('admin', 'chairman', 'director') THEN
    -- 全權
    NULL;
  ELSIF v_caller_role = 'manager' THEN
    IF v_owner_team IS NULL OR v_owner_team <> v_caller_team THEN
      RAISE EXCEPTION '非本課客戶，無審核權' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION '沒有審核權限' USING ERRCODE = '42501';
  END IF;

  -- 5. 更新申請狀態
  UPDATE transfer_requests
  SET status = CASE WHEN p_approved THEN 'approved' ELSE 'rejected' END,
      reviewed_by = v_caller_id,
      reviewed_at = now()
  WHERE id = p_request_id;

  -- 6. 核准 → 轉移客戶 + 寫兩筆稽核軌跡
  IF p_approved THEN
    UPDATE customers
    SET assigned_to = v_req.requested_by,
        status = 'reactivating',
        created_date = v_today,
        locked_at = NULL,
        locked_reason = NULL
    WHERE id = v_req.customer_id;

    INSERT INTO customer_history (customer_id, action_type, action_by, from_user, to_user, note)
    VALUES (v_req.customer_id, 'transfer_approved', v_caller_id, v_current_owner, v_req.requested_by, '認領申請已核准');

    INSERT INTO customer_history (customer_id, action_type, action_by, note)
    VALUES (v_req.customer_id, 'reactivated', v_caller_id, '客戶重新開發');
  END IF;

  -- 7. 通知申請人
  INSERT INTO notifications (user_id, title, message, link)
  VALUES (
    v_req.requested_by,
    CASE WHEN p_approved THEN '認領申請已核准' ELSE '認領申請已拒絕' END,
    format('您對「%s」的認領申請已%s', v_customer_name, CASE WHEN p_approved THEN '核准' ELSE '被拒絕' END),
    format('/customers/%s', v_req.customer_id)
  );

  RETURN json_build_object(
    'success', true,
    'approved', p_approved,
    'company_name', v_customer_name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION review_transfer_request(UUID, BOOLEAN) TO authenticated;
