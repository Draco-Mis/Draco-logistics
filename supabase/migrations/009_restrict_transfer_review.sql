-- 收緊客戶轉移審核權限（transfer_requests UPDATE 政策）
--
-- 調整後的規則：
--   admin / chairman / director → 全部轉移申請皆可審核
--   manager                    → 僅可審核「客戶目前負責人與自己同課別」的申請
--   其他                       → 不能審核
--
-- 舊政策的問題：
--   director / chairman 不在允許列表，前端看得到審核按鈕，但存檔失敗。
--
-- 與 migration 007 / 008 的 manager 團隊規則一致。

DROP POLICY IF EXISTS "transfer_requests_update" ON transfer_requests;

CREATE POLICY "transfer_requests_update" ON transfer_requests FOR UPDATE TO authenticated
  USING (
    -- admin / chairman / director：全部
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
        AND u.role IN ('admin', 'chairman', 'director')
    )
    OR
    -- manager：僅可審核「客戶目前負責人與自己同課別」的申請
    EXISTS (
      SELECT 1
      FROM users me,
           customers c,
           users assigned
      WHERE me.id = auth.uid()
        AND me.role = 'manager'
        AND c.id = transfer_requests.customer_id
        AND assigned.id = c.assigned_to
        AND me.team = assigned.team
    )
  );
