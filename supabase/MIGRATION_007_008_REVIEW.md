# Migration 007 + 008 執行前 Review

產生時間：2026-04-21
目的：review only，SQL 尚未執行。

---

## ⚠️ 預先提醒（兩個名稱上的釐清）

1. **表名**：你問的是 `contact_history`，實際資料庫的表叫 **`customer_history`**（單數、前綴 `customer_`）。另外還有一張 **`customer_contacts`** 是聯絡人表（由 Supabase UI 建立，不在 `schema.sql` 裡）。這份文件用正確表名。
2. **Item 5（列出現有 policies）** 我無法代你執行 — 沒有你的 Supabase DB 連線。文件最後會給你可貼上的 SQL 查詢。

---

## 1. Migration 007 完整內容

檔案：`supabase/migrations/007_restrict_contact_history_access.sql`（57 行）

```sql
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
```

### 1.a 這個 migration 會改變誰能做什麼？

影響三張表：`customer_contacts`、`customer_history`、`comments`
影響操作：**只限 SELECT（讀取）**，寫入不動

| 角色 | 執行前（現況）讀取權限 | 執行後讀取權限 |
|---|---|---|
| 任何登入者 | 全部客戶的聯絡人 / 歷史 / 留言都看得到 | — |
| admin | （同上） | ✅ 全部 |
| chairman | （同上） | ✅ 全部 |
| director | （同上） | ✅ 全部 |
| manager | （同上） | ✅ 僅**與自己同課別**的負責業務所屬客戶 |
| sales / 一般業務 | （同上） | ✅ 僅自己**目前是 `assigned_to`** 的客戶 |
| 被轉走的前負責業務 | 仍看得到 | ❌ 立即失去讀取權 |

白話舉例：
- 業一課課長 → 可以看**業一課**任一業務負責的客戶的歷史/留言/聯絡人；看不到業二課
- 業務 A 原本是 X 公司負責人，客戶被轉給業務 B → A 從此看不到 X 公司的歷史/留言/聯絡人
- 其他業務看不到你的客戶的聯絡人清單與歷史軌跡（但能看到公司名、等級、狀態這類基本資料 — 因為 `customers` 的 SELECT 政策沒被這個 migration 動）

### 1.b 會 DROP 哪些既有 policies？

| Policy 名稱 | 所在表 |
|---|---|
| `customer_history_select` | `customer_history` |
| `comments_select` | `comments` |
| `customer_contacts_select` | `customer_contacts` |

全部用 `DROP POLICY IF EXISTS`，不存在也不會報錯。

### 1.c 會 CREATE 哪些新 policies？

| Policy 名稱 | 所在表 | 操作 | 條件 |
|---|---|---|---|
| `customer_history_select` | `customer_history` | SELECT | `can_view_customer_detail(customer_id)` |
| `comments_select` | `comments` | SELECT | `can_view_customer_detail(customer_id)` |
| `customer_contacts_select` | `customer_contacts` | SELECT | `can_view_customer_detail(customer_id)` |

政策名稱**跟舊的一樣**（是覆蓋）。

另外會建立一個 **function**（非 policy）：

- `can_view_customer_detail(p_customer_id UUID) RETURNS BOOLEAN`
  - `SECURITY DEFINER` + `STABLE` + `SET search_path = public`
  - `CREATE OR REPLACE`，已存在會覆寫

### 1.d `auth.uid()` / `auth.jwt()` / custom claim 用到什麼？

- ✅ 使用 `auth.uid()` — Supabase 內建，回傳當前登入者在 `auth.users` 的 UUID
- ❌ 沒有用 `auth.jwt()`
- ❌ 沒有用 custom claim

**邏輯流程（函式內部）：**

1. 以 `auth.uid()` 到 `users` 表找到「我」（me）
2. 以傳入的 `p_customer_id` 到 `customers` 表找到該客戶（c）
3. 以該客戶的 `assigned_to` 到 `users` 表找到負責業務（assigned，LEFT JOIN，允許 NULL）
4. 判斷三者條件（OR）：
   - `me.role IN ('admin','chairman','director')` → 直接 pass
   - `c.assigned_to = auth.uid()` → 是負責業務本人 → pass
   - `me.role = 'manager' AND me.team = assigned.team` → 課長且同課別 → pass
5. 任一條件為真，回傳 `TRUE`；否則 `FALSE`

**為什麼要 `SECURITY DEFINER`：**
這個函式在 `customer_contacts` / `customer_history` / `comments` 的 RLS 政策裡被呼叫。如果是 `SECURITY INVOKER`（預設），函式內對 `users` 和 `customers` 的查詢會再走一次呼叫者的 RLS，容易引發遞迴或遺漏。用 `SECURITY DEFINER` 讓函式以函式擁有者（通常是 postgres/supabase_admin）的權限讀資料，**但只回傳一個布林值**，不會洩漏內部資料。

**`SET search_path = public`：** 防禦 `SECURITY DEFINER` 函式常見的 schema 注入風險，鎖定解析對象。

---

## 2. Migration 008 完整內容

檔案：`supabase/migrations/008_restrict_customer_update.sql`（38 行）

```sql
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
```

### 2.a 這個 migration 會改變誰能做什麼？

影響表：`customers` 一張
影響操作：**只限 UPDATE（修改既有客戶）**，SELECT / INSERT / DELETE 不動

| 角色 | 執行前（現況）UPDATE 權限 | 執行後 UPDATE 權限 |
|---|---|---|
| admin | ✅ 全部 | ✅ 全部 |
| chairman | ❌ **完全不能**（前端能按，但存檔失敗） | ✅ 全部 |
| director | ❌ **完全不能**（前端能按，但存檔失敗） | ✅ 全部 |
| manager | ✅ 全部（不分課別） | ✅ **僅自己課別** |
| 負責業務 | ✅ 僅當狀態是 `active_developing` / `warning` | ✅ 只要狀態**不是 `locked`** |
| 其他業務 | ❌ | ❌ |

白話重點：
- 部長／董事長的「存檔失敗」bug 修掉
- 課長跨課別編輯的漏洞補起來（與 007 的檢視邏輯一致）
- 負責業務在「洽談中 / 已成交 / 長期合作 / 未成交 / 重新開發中」狀態下也能改客戶資料了

### 2.b 會 DROP 哪些既有 policies？

| Policy 名稱 | 所在表 |
|---|---|
| `customers_update` | `customers` |

### 2.c 會 CREATE 哪些新 policies？

| Policy 名稱 | 所在表 | 操作 | 條件（簡述） |
|---|---|---|---|
| `customers_update` | `customers` | UPDATE | `(admin/chairman/director)` OR `(manager 且同課別)` OR `(自己是 assigned_to 且狀態非 locked)` |

這個 migration **不使用 function** — 邏輯直接內嵌在 policy 的 `USING` clause。

### 2.d `auth.uid()` / `auth.jwt()` / custom claim 用到什麼？

- ✅ 使用 `auth.uid()` — 三處：`u.id = auth.uid()`（判斷角色）、`me.id = auth.uid()`（課長本人）、`assigned_to = auth.uid()`（負責業務本人）
- ❌ 沒有用 `auth.jwt()`
- ❌ 沒有用 custom claim

**邏輯流程（policy 評估每一筆 row）：**

Postgres 在 UPDATE 一筆 `customers` 列時，會以**當前登入者**逐條檢查 `USING` 條件（OR 串接）：

1. **第一條**：`auth.uid()` 在 `users` 表是 admin / chairman / director？是就 pass。
2. **第二條**：`auth.uid()` 是 manager，且 `users` 表裡自己的 `team` 等於「這筆客戶的 `assigned_to` 那個人的 `team`」？是就 pass。
3. **第三條**：這筆客戶的 `assigned_to` 就是 `auth.uid()` 本人，而且目前 `status` 不是 `'locked'`？是就 pass。

任何一條符合即允許更新該列。

**注意：** 這個 policy 沒有 `WITH CHECK` 子句。PostgreSQL 預設 `WITH CHECK = USING`，意思是「更新**後**的列也要滿足同樣條件」。在這個 policy 下沒問題 — 欄位 `assigned_to` 和 `status` 的限制在新舊值上都會驗證。

---

## 3. RLS 啟用狀態（根據 `schema.sql`）

| 表名 | RLS 啟用？ | 來源 |
|---|---|---|
| `users` | ✅ | `schema.sql` 第 106 行 |
| **`customers`** | ✅ | `schema.sql` 第 107 行 |
| **`customer_history`** | ✅ | `schema.sql` 第 108 行 |
| `comments` | ✅ | `schema.sql` 第 109 行 |
| `transfer_requests` | ✅ | `schema.sql` 第 110 行 |
| `notifications` | ✅ | `schema.sql` 第 111 行 |
| **`customer_contacts`** | ⚠️ 不在 `schema.sql` | Migration 007 執行時會啟用（`ALTER TABLE ... ENABLE ROW LEVEL SECURITY` 為冪等操作） |

**結論：** `customers` 和 `customer_history` **真的有開 RLS**，目前是**資料庫政策 + 前端 filter 雙層**。不是「只靠前端 filter」。

但因為現有政策都寫成 `USING (true)`（見下一節），實際效果**跟沒 RLS 差不多**（任何 authenticated 使用者都可通過）。Migration 007、008 的目的就是把 `USING (true)` 換成真正有權限判斷的條件。

`customer_contacts` 狀況較模糊 — 因為這張表是你後來用 Supabase UI 加的，RLS 狀態需要你跑 Item 5 的 SQL 才能確認。

---

## 4. 現有 policies 查詢 SQL（你自己跑）

以下 SQL 只是 **SELECT**（只讀、不修改任何東西），可以安全在 Supabase SQL Editor 執行。

### 4.a 列出 customers / customer_history / customer_contacts / comments 的現有 policies

```sql
SELECT
  schemaname,
  tablename,
  policyname,
  cmd          AS operation,    -- SELECT / INSERT / UPDATE / DELETE / ALL
  roles,
  permissive,
  qual         AS using_clause,  -- USING 條件
  with_check                     -- WITH CHECK 條件
FROM pg_policies
WHERE tablename IN ('customers', 'customer_history', 'customer_contacts', 'comments')
ORDER BY tablename, cmd, policyname;
```

### 4.b 確認四張表的 RLS 啟用狀態

```sql
SELECT
  schemaname,
  tablename,
  rowsecurity      AS rls_enabled,
  forcerowsecurity AS rls_forced
FROM pg_tables
WHERE tablename IN ('customers', 'customer_history', 'customer_contacts', 'comments')
ORDER BY tablename;
```

### 4.c 確認 `can_view_customer_detail` 函式是否已存在（007 跑過可能會有殘留）

```sql
SELECT proname, prosecdef, pronargs
FROM pg_proc
WHERE proname = 'can_view_customer_detail';
```

> 第一次 review 時預期空結果；若回傳一筆，代表函式已存在（重跑 007 會用 `CREATE OR REPLACE` 覆蓋，不會失敗）。

---

## 5. 冪等性與回滾

### 冪等性
- 兩個 migration 都使用 `DROP POLICY IF EXISTS` + `CREATE POLICY` 或 `CREATE OR REPLACE FUNCTION`
- 可重複執行，**不會報錯**

### 回滾（若套用後想退回去）

**回滾 Migration 008：** 在 SQL Editor 執行
```sql
DROP POLICY IF EXISTS "customers_update" ON customers;

CREATE POLICY "customers_update" ON customers FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'manager'))
    OR
    (assigned_to = auth.uid() AND status IN ('active_developing', 'warning'))
  );
```

**回滾 Migration 007：** 在 SQL Editor 執行
```sql
DROP POLICY IF EXISTS "customer_history_select"  ON customer_history;
DROP POLICY IF EXISTS "comments_select"          ON comments;
DROP POLICY IF EXISTS "customer_contacts_select" ON customer_contacts;

CREATE POLICY "customer_history_select"  ON customer_history  FOR SELECT TO authenticated USING (true);
CREATE POLICY "comments_select"          ON comments          FOR SELECT TO authenticated USING (true);
CREATE POLICY "customer_contacts_select" ON customer_contacts FOR SELECT TO authenticated USING (true);

DROP FUNCTION IF EXISTS can_view_customer_detail(UUID);
```

---

## 6. 建議執行順序（若未來要上）

1. 先在**非正式環境 / 備份資料庫**測試（若有的話）
2. 用你自己的帳號（admin）登入，跑 Item 4.a 的 SELECT，記下目前 policies 長什麼樣（當作回滾參考）
3. 執行 `007_restrict_contact_history_access.sql`
4. 執行 `008_restrict_customer_update.sql`
5. 再跑一次 4.a 的 SELECT，確認政策已替換
6. 用不同角色（admin / chairman / director / manager / sales）帳號到 `/customers/<id>` 實測檢視與編輯行為
7. 若異常，執行 Section 5 的回滾 SQL

**無須任何 schema 變動**（沒有新增 column、沒有改 type）— 所以可以在尖峰外任何時段執行，客戶不會看到中斷。

---

## 7. 本文件中**尚未**執行的動作（由你決定時機）

- [ ] 執行 `supabase/migrations/007_restrict_contact_history_access.sql`
- [ ] 執行 `supabase/migrations/008_restrict_customer_update.sql`
- [ ] 執行 Section 4 的 SELECT 查詢（這是只讀查詢，你想什麼時候跑都可以）

目前本機與 Vercel 線上的**程式碼**已部署（前端 UI 守門、Excel 匯出、完成度修正），但 RLS 政策尚未生效 — UI 會擋一般使用者，技術上仍可繞過。
