-- =============================================
-- Migration 017: 軟刪除客戶用 RPC 函式（修 PostgREST RETURNING 撞 RLS 的 bug）
-- =============================================
-- 問題：
--   前端 .update({ deleted_at: NOW() }) 時，PostgREST 內部用 RETURNING 拿回新 row。
--   新 row 的 deleted_at IS NOT NULL → 違反 customers_select policy（要求 IS NULL）→
--   拋出「new row violates RLS policy」錯誤，使用者看不到客戶被刪掉。
--
-- 解法：
--   寫 SECURITY DEFINER 函式 admin_soft_delete_customer：
--   1. 函式以函式擁有者身份（postgres）執行，繞過 RLS
--   2. 函式內部明確檢查呼叫者是 admin 且 in 職
--   3. UPDATE 客戶 + INSERT 稽核軌跡
--   4. 前端用 supabase.rpc('admin_soft_delete_customer', { p_id: ... })
-- =============================================

CREATE OR REPLACE FUNCTION admin_soft_delete_customer(p_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_caller_name TEXT;
  v_caller_role TEXT;
  v_caller_active BOOLEAN;
  v_customer_name TEXT;
BEGIN
  -- 1. 確認呼叫者是 admin 且 in 職
  SELECT
    COALESCE(chinese_name, name),
    role::text,
    is_active
  INTO v_caller_name, v_caller_role, v_caller_active
  FROM users
  WHERE id = v_caller_id;

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION '未登入' USING ERRCODE = '42501';
  END IF;
  IF v_caller_active IS NOT TRUE THEN
    RAISE EXCEPTION '帳號已停用，無法刪除客戶' USING ERRCODE = '42501';
  END IF;
  IF v_caller_role <> 'admin' THEN
    RAISE EXCEPTION '只有管理員可以軟刪除客戶' USING ERRCODE = '42501';
  END IF;

  -- 2. 確認客戶存在且尚未刪除
  SELECT company_name INTO v_customer_name
  FROM customers
  WHERE id = p_id AND deleted_at IS NULL;

  IF v_customer_name IS NULL THEN
    RAISE EXCEPTION '客戶不存在或已刪除' USING ERRCODE = '02000';
  END IF;

  -- 3. 軟刪除
  UPDATE customers SET deleted_at = NOW() WHERE id = p_id;

  -- 4. 寫稽核軌跡
  INSERT INTO customer_history (customer_id, action_type, action_by, note)
  VALUES (
    p_id,
    'deleted',
    v_caller_id,
    format('管理員 %s 軟刪除此客戶', COALESCE(v_caller_name, '<未命名>'))
  );

  RETURN json_build_object(
    'success', true,
    'customer_id', p_id,
    'company_name', v_customer_name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_soft_delete_customer(UUID) TO authenticated;

-- 同場加映：批次版（給 /admin/duplicates 用）
CREATE OR REPLACE FUNCTION admin_soft_delete_customers(p_ids UUID[])
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_success INT := 0;
  v_failed INT := 0;
  v_errors TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN json_build_object('success', 0, 'failed', 0);
  END IF;

  FOREACH v_id IN ARRAY p_ids LOOP
    BEGIN
      PERFORM admin_soft_delete_customer(v_id);
      v_success := v_success + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      v_errors := array_append(v_errors, format('%s: %s', v_id::text, SQLERRM));
    END;
  END LOOP;

  RETURN json_build_object(
    'success', v_success,
    'failed', v_failed,
    'errors', v_errors
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_soft_delete_customers(UUID[]) TO authenticated;
