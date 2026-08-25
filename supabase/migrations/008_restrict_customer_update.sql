-- 收緊客戶編輯權限（customers UPDATE 政策）
--
-- 調整後的規則：
--   admin / chairman / director → 全部客戶皆可編輯
--   manager                    → 僅可編輯「負責業務與自己同課別」的客戶
--   負責業務（assigned_to）     → 只要狀態不是 locked 就能編輯
--   其他                       → 不能編輯
--
-- 舊政策的問題：
--   1. director / chairman 不在允許列表，點編輯會存檔失敗
--   2. manager 可跨課別編輯（與 migration 007 檢視限制不一致）
--   3. 負責業務只有 active_developing / warning 能存檔
--      （其他狀態如洽談中/已成交仍想改也存不下來）

DROP POLICY IF EXISTS "customers_update" ON customers;

CREATE POLICY "customers_update" ON customers FOR UPDATE TO authenticated
  USING (
    -- admin / chairman / director：全部
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
        AND u.role IN ('admin', 'chairman', 'director')
    )
    OR
    -- manager：只能改自己課別的客戶
    EXISTS (
      SELECT 1
      FROM users me, users assigned
      WHERE me.id = auth.uid()
        AND me.role = 'manager'
        AND assigned.id = customers.assigned_to
        AND me.team = assigned.team
    )
    OR
    -- 負責業務：非 locked 都能編輯
    (assigned_to = auth.uid() AND status <> 'locked')
  );
