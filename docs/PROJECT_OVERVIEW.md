# Draco LOP 系統概覽

> **Draco LOP — 登泰國際物流營運管理平台** (Draco Logistic Operation Platform) · 登泰國際物流股份有限公司。前身為 Draco CRM；隨著物流部、報關部、財務部加入使用而擴大範疇後改名。
> 給 AI 助理（Claude Project / Code）用的單頁系統說明書。每次重大功能調整後請要求 AI 同步更新此檔。
> 最後更新對應 commit：執行 `git log -1 docs/PROJECT_OVERVIEW.md` 查詢。

---

## 1. 一句話定位

登泰國際物流股份有限公司的內部營運管理平台。核心模組為**業務客戶管理（CRM）**：管理約 20 人業務團隊的客戶開發進度，邏輯是**強制 90 天倒數**——客戶建檔/重新指派起算，不在 90 天內推進就鎖檔，避免客戶被某人「占住」不動。

延伸模組：
- **邏輯思維評估**：免登入公開連結、20 題隨機版本、HR 後台查看 / 匯出（詳見第 12 章）

---

## 2. 技術棧

| 類別 | 套件 | 備註 |
|------|------|------|
| Framework | Next.js 14 (App Router) | TypeScript |
| 樣式 | Tailwind CSS 3 | 自定 utility：`card`、`btn-primary`、`btn-secondary`、`btn-danger`、`input-field` |
| 資料庫 / Auth | Supabase（PostgreSQL + Auth + RLS） | `@supabase/ssr` 0.1（推 server cookies）、`@supabase/supabase-js` 2 |
| 部署 | Vercel | 已驗證 email：`hansmorgen@gmail.com` |
| PWA | manifest.json | 無 service worker；`display: standalone` |
| 圖表 | recharts | /admin/performance、reports |
| 檔案處理 | xlsx (SheetJS) + papaparse + @types/papaparse | /admin/import 用 |
| 日期 | date-fns 3 | |
| Email | Resend API（直接 fetch，無套件依賴） | 環境變數：`RESEND_API_KEY`、`EMAIL_FROM`；未設定時 graceful skip，不中斷流程 |
| Telegram | 原生 fetch | `src/lib/telegram.ts`；無套件依賴 |

開發指令：`npm run dev`（127.0.0.1）、`npm run build`、`npm run lint`。
本地路徑：`~/Desktop/draco-crm`；快捷指令 `crm`（tmux session，自動 cd + 啟動 Claude Code）。
Supabase Project ID：`fbnqanywnnjtntvliljw`；Dashboard：https://supabase.com/dashboard/project/fbnqanywnnjtntvliljw

---

## 3. 角色與課別

### 角色 (`UserRole`)

| 值 | 中文 | 主要權限 |
|----|------|---------|
| `admin` | 管理員 | 全權限：管帳號、改任何客戶、看所有報表、匯入匯出 |
| `chairman` | 董事長 | 看所有客戶、審轉移、管使用者；不看報表/匯入 |
| `director` | 部長 | 看所屬部門客戶、審本部門轉移、看績效 |
| `manager` | 課長 | 審「同課別」轉移申請（migration 009）、看本課報表 |
| `sales` | 業務 | 編輯自己的客戶（status 非 locked），改狀態，留言 |

> ⚠️ **schema 差異注意**：`schema.sql` 第 12 行寫的是舊版三角色；實際系統以 TS 型別（`src/types/database.ts`）為準，後續 migration（002 加 chairman、其他擴充）已修改 CHECK 約束。

### 課別 (`Team`)

migration 010 後完整清單：

```
業一課、業二課、專案課、電商課、
業務部、管理員、報關部、
物流一部、物流二部、
物流一部遠洋課、物流一部大陸課、物流一部大陸進口課、
物流二部空運課、物流二部三角課、
崧盛
```

### 組織結構

| 課別 | 課長 | 成員 |
|------|------|------|
| 業一課 | 莊采妮 Reina（副課長：王家晟 Max） | Jill、Oscar、Rex、Kenny、Brad |
| 業二課 | 吳秀美 May | Sophie、Leo、Grace、Jumbo、Chris |
| 專案課 | （無正式主管） | Aaron、Vera、Andy |
| 電商課 | 直屬 Apple 副總 | 蔡維珊、顏汎如 |

> 電商課非業務部，但同樣使用 CRM。

---

## 4. 客戶生命週期 — 90 天倒數核心邏輯

### 倒數錨點

**`customers.created_date`**（DATE 型別）。`elapsed = today - created_date`。

任何「重新指派」會把 `created_date` 重設為今天，等於倒數歸零。三條重指派路徑：
1. 業務認領 → 主管核准（`/transfers`）
2. 主管/admin 在客戶詳情頁直接改負責業務（`/customers/[id]`）
3. `/admin/import` 覆蓋更新且 `assigned_to` 與既有不同

三條都會：`created_date = 今天` + `status = reactivating` + 清空 `locked_at` / `locked_reason` + 寫 `transfer_approved` & `reactivated` 歷史。

### 通知層級（cron 每天 UTC 16:00 = 台灣 24:00）

| 天數 | 事件 | 站內通知對象 | Email | Telegram | DB 變動 |
|------|------|--------------|-------|----------|---------|
| 30 | `notify_30` | 業務 | – | – | – |
| 60 | `notify_60` | 業務 + 課長 | – | – | – |
| 75 | `warning` | 業務 + 課長 | 業務（`emailTemplateWarning75`） | 業務 | `status` → `warning`（若原為 active_developing/reactivating） |
| 80 | `notify_80` | 業務 + 課長 + admin | – | – | – |
| 90 | `locked` | 業務 + 課長 + admin | 業務 + 課長 + admin（`emailTemplateLocked90`） | 業務 + 課長 + admin | `status` → `locked`，寫 `locked_at` 與 `locked_reason` |

### 重複通知防呆

cron 查詢 `customer_history` 中該客戶已發過的 action_type，但**只看 `action_date >= customers.created_date`**（自 commit `9eb1c0c` 起）——所以重新指派把 `created_date` 重設後，舊紀錄自動失效，新一輪會完整重發 30/60/75/80/90。

### 不受 90 天約束的狀態

`completed`（已成交）、`long_term`（長期合作）、`abandoned`（未成交）、`locked`（已鎖檔）。cron 不處理。

### Cron Jobs 總覽

| 路由 | 執行時間（台灣） | 功能 |
|------|----------------|------|
| `/api/cron/status-check` | 每天 24:00 | 計算各客戶天數，觸發警示 / 鎖檔 |
| `/api/cron/weekly-summary` | 每週一 08:00 | 每位在職人員產生站內週報 |
| `/api/cron/diagnostics` | 每天 04:00 | 資料健康檢查 + 自動修復（locked 缺 locked_at、過期通知清理等） |

---

## 5. 資料模型 (Supabase)

### 主要 tables

| Table | 用途 | 重要欄位 |
|-------|------|---------|
| `users` | 帳號 | `id`, `email`, `name`, `chinese_name`, `role`, `team`, `is_active`, `telegram_id`, `password_changed` |
| `customers` | 客戶 | `company_name`, `company_code`, `company_code_type`(上市/上櫃/興櫃/一般公司), `industry`(12 類), `assigned_to`, `created_date`(倒數錨點), `last_contact_date`, `status`, `grade`(A/B/C), `created_by`, `locked_at`, `locked_reason` |
| `customer_history` | 稽核軌跡 | `action_type`, `action_by`, `action_date`, `from_user`, `to_user`, `note` |
| `customer_contacts` | 聯絡人 | `name`, `title`, `phone`, `email` |
| `comments` | 客戶留言 | 任何人可留，會 push 通知給負責業務 + 之前留過言的人 |
| `transfer_requests` | 轉移申請 | `requested_by`, `status`(pending/approved/rejected), `reviewed_by`, `note` |
| `notifications` | 站內通知 | `user_id`, `title`, `message`, `link`, `is_read` |
| `assessment_events` | 邏輯評估活動（HR 建立） | `code`(UNIQUE)、`name`、`test_types`、`deadline`、`is_active`、`created_by`（詳見第 12 章） |
| `assessment_submissions` | 邏輯評估作答紀錄 | `event_id`、`respondent_name`、`department`、`version`、`logic_answers`、`logic_scores`、`status`（詳見第 12 章） |

### 列舉值

- `CustomerStatus`：`active_developing`、`negotiating`、`completed`、`long_term`、`abandoned`、`warning`、`locked`、`reactivating`
- `CustomerGrade`：A / B / C
- `CompanyCodeType`：上市 / 上櫃 / 興櫃 / 一般公司
- `Industry`（12 類）：電子科技業、機械製造業、化工原物料、紡織成衣業、食品飲料業、醫療保健業、汽車零組件、貿易進出口、電商零售業、建材五金業、能源環保業、其他
- `HistoryActionType`：created / notify_30 / notify_60 / warning / notify_80 / locked / transfer_requested / transfer_approved / reactivated / mark_negotiating / mark_completed / mark_long_term / mark_abandoned / mark_developing
- `WarningTier`（純 UI 顯示，不存 DB）：依 elapsed 與 status 推導

### RLS 摘要

- `users`：所有人可讀；admin 才能改
- `customers`：所有人可讀；admin/director/chairman 可改全部；manager 限同課別；業務只能改自己負責且 status 非 locked 的
- `customer_history` / `comments` / `customer_contacts`：由 `can_view_customer_detail()` 函式控制（見下）
- `transfer_requests`：可讀；申請者自己 insert；admin/director/chairman 全審；manager 限同課別（migration 009）
- `notifications`：只看自己的；可標自己讀過；可刪自己的（migration 003）

### RLS 核心函式（migration 007）

```sql
can_view_customer_detail(p_customer_id UUID) RETURNS BOOLEAN
SECURITY DEFINER  -- 防止 RLS 遞迴查詢
```

判斷邏輯：
- `admin` / `chairman` / `director` → 全通
- `manager` → 負責業務與自己同 `team`
- `sales` → 自己是 `assigned_to`

套用於 `customer_history`、`comments`、`customer_contacts` 三張表的 SELECT 政策。負責業務轉移後，舊業務自動失去讀取權限。

### Migration 歷程

| # | 說明 |
|---|------|
| 001 | customer_history action_type 加入 notify_30/60/80 |
| 002 | 新增 chairman 角色；更新 customers / transfer_requests / users RLS |
| 003 | notifications 允許使用者刪除自己的通知 |
| 004 | 新增成交相關狀態；業務可編輯非 locked 的所有自己客戶 |
| 005 | 新增 industry 欄位（4 類） |
| 006 | industry 擴充為 12 類 |
| 007 | 新增 `can_view_customer_detail()` 函式；限制 history / comments / contacts SELECT |
| 008 | customers UPDATE 收緊：補 director / chairman；manager 限同課別 |
| 009 | transfer_requests UPDATE 收緊：補 director / chairman；manager 限同課別 |
| 010 | users.team CHECK 擴充（含物流子課 + 崧盛） |
| 011 | customer_contacts 寫入權限收緊：新增 `can_manage_customer_contact()` 函式；INSERT/UPDATE/DELETE 限 admin/chairman/director/manager（manager 限同課別）；sales 唯讀 |
| 012 | customers 加 `deleted_at`（軟刪除）；`customers_select` RLS 過濾 `deleted_at IS NULL`；`find_similar_customers()` 相似度 RPC |
| 013 | 放寬聯絡人寫入：負責業務本人在客戶非鎖檔時可管理自己客戶的聯絡人 |
| 014 | 啟用 Realtime publication（customers / customer_history / comments / customer_contacts） |
| 015 | RLS 全面加 `is_active_user()` 檢查（離職員工第 4 道防線） |
| 016 | users 加 `deactivated_at` 紀錄離職時間 |
| 017 | `admin_soft_delete_customer()` / `admin_soft_delete_customers()` RPC，繞 PostgREST RETURNING + RLS 衝突 |
| 018 | （已移除）原 Big Five 人格測驗 `bigfive_assessments` table；migration 檔保留歷史紀錄 |
| 019 | **邏輯思維評估**：`assessment_events` + `assessment_submissions`；`is_hr_role()` 函式；submissions 公開 INSERT、SELECT/UPDATE 限 admin/director |

---

## 6. 路由 / 功能對應

### 公開
| Route | 用途 |
|-------|------|
| `/login` | Supabase Auth 信箱+密碼登入 |
| `/set-password` | 首次登入或邀請信回流的改密碼頁 |
| `/api/auth/callback` | Supabase OAuth/邀請信 code 兌換 |
| `/api/auth/signout` | **Server-side 登出**：清 cookies → 302 redirect `/login` |
| `/assess/[code]` | **邏輯思維評估**公開作答頁（免登入）：填基本資料 → 20 題 → 個人報告 |
| `/api/assess/[code]/info` | GET：取得活動狀態與既有 submission |
| `/api/assess/[code]/start` | POST：建立 submission、隨機分配版本、回傳打亂題目 |
| `/api/assess/[code]/save` | POST：autosave 暫存答案 |
| `/api/assess/[code]/submit` | POST：server 計分 + 標記 completed |

### `(main)` 受保護群組
| Route | 用途 |
|-------|------|
| `/customers` | 全公司客戶列表，模糊搜尋 + 篩選（狀態、等級、產業、負責人） |
| `/customers/[id]` | 客戶詳情：基本資料、狀態變更、留言、稽核歷史、轉移申請按鈕、admin 直接重指派 |
| `/customers/new` | 新增客戶 |
| `/my-customers` | 自己負責的客戶 |
| `/notifications` | 站內通知，可單筆/全部標已讀，可刪除 |
| `/transfers` | 轉移審核佇列：pending / history 兩 tab |
| `/more` | 個人設定 + admin 管理入口 |

### `/admin/*`
| Route | 角色 | 用途 |
|-------|------|------|
| `/admin/users` | admin / chairman | 邀請/停用使用者、設角色課別 |
| `/admin/reports` | admin / director / manager | 每週數據報表 |
| `/admin/performance` | admin / chairman / director / manager | 業務績效（recharts） |
| `/admin/import` | admin only | CSV/Excel 三步驟匯入：上傳/預覽 → 衝突檢查 → 批次寫入 |
| `/admin/export` | admin only | 多分頁 Excel 匯出 |
| `/admin/batch-grade` | admin / chairman / director / manager | 批次調整等級 |
| `/admin/duplicates` | admin only | 重複客戶清理（pg_trgm 相似度比對 + 批次軟刪） |
| `/admin/departed` | admin / chairman / director / manager | 離職員工管理 + 批次轉移客戶 |
| `/admin/assessments` | admin / director | **邏輯思維評估**活動列表、建立活動（自動產 8 位 code）、停用/啟用 |
| `/admin/assessments/[id]` | admin / director | 單一活動結果列表（部門篩選）、單筆檢視、匯出 Excel |

### API
| Route | 用途 |
|-------|------|
| `/api/admin/users` 系列 | 邀請、改密碼、更新使用者（service role key） |
| `/api/admin/test-email` | 測試 Resend email 連線 |
| `/api/cron/status-check` | 每天 24:00：90 天狀態檢查 |
| `/api/cron/weekly-summary` | 每週一 08:00：站內週報 |
| `/api/cron/diagnostics` | 每天 04:00：資料健康檢查 + 自動修復 |
| `/api/notifications/welcome` | 新人歡迎通知 |
| `/api/stock-lookup` | 股票代號查詢 |
| `/api/webhook/telegram` | Telegram Bot Webhook |
| `/api/admin/assessments/create` | 建立邏輯評估活動（限 admin / director） |

---

## 7. 通知管道

| 管道 | 狀態 | 說明 |
|------|------|------|
| 站內通知 | ✅ 上線 | `notifications` table；未讀數出現在 sidebar |
| Email | ✅ 已實作（待啟用） | Resend API；需在 Vercel 設 `RESEND_API_KEY` + `EMAIL_FROM`；未設定時 graceful skip |
| Telegram | 🔲 Webhook 架構已建 | `src/lib/telegram.ts`；須 `users.telegram_id` 已綁定；`sendTelegramToUsers` 內部跳過沒綁的 |

> ⚠️ **已知問題**：進入 `/notifications` 頁面會自動全部標記已讀，需改為手動標記機制。

---

## 8. 中介層（Middleware）

`src/middleware.ts`：
- 公開路徑 `/login`、`/set-password`、`/auth`、`/assess`（邏輯評估公開作答）開頭外，未登入一律導 `/login`
- 已登入但訪問 `/login` 會被導 `/customers`
- URL 帶 `?code=xxx`（Supabase 重設密碼/邀請信）會強制送 `/api/auth/callback?next=/set-password`
- session 存在時會查 `users.is_active`，false 則導 `/api/auth/signout` 清 cookies（migration 014+015 離職員工守門）
- Matcher 排除 `_next/static`、`_next/image`、`favicon.ico`、`manifest.json`、`icon-*.png`、`api/`

---

## 9. 客戶端 Auth（`src/lib/auth-context.tsx`）

- `AuthProvider` 監聽 `onAuthStateChange`，存 session 與 `users` row
- **登出**：呼叫 `signOut()` 直接 `window.location.href = '/api/auth/signout'`，server 清 cookies 後 302 跳 `/login`
- **24 小時自動登出**：`localStorage` 紀錄首次取得 session 的時間戳，過期觸發 `signOut`；新登入時刷新時間戳；背景排程 `setTimeout`，跨多分頁共享 localStorage

---

## 10. 部署

- GitHub repo：`Hans-Owner/draco-crm`，主分支 `main`
- Vercel 專案：`draco-crm`，alias 域名：https://draco-crm.vercel.app
- 部署觸發：push 到 `main` 透過 GitHub webhook 自動部署（約 2–3 分鐘）
- 備用：`npx --yes vercel@latest --prod --yes`（已有 `.vercel/project.json`）
- Cron jobs 由 `vercel.json` 定義（三條）
- ⚠️ git commit 必須用 `hansmorgen@gmail.com`，用 `hans@dracolog.com` 會被 Vercel block

---

## 11. 設計決策 / 重要取捨

| 主題 | 決定 | 為什麼 |
|------|------|--------|
| 重指派時的倒數 | 重設 `created_date` 為今天 | 新業務應該有完整 90 天，避免吃舊倒數鎖檔 |
| cron 重複通知防呆 | 用 `created_date` 為錨點過濾舊歷史 | 零 schema 變更；重指派自動失效舊紀錄 |
| RLS 用函式而非直接 policy | `can_view_customer_detail()` 集中邏輯 | 三張表共用；SECURITY DEFINER 防遞迴 |
| 登出 | server-side route + HTML `<a>` | client-side router.replace 在某些 PWA/快取情境失效，hard navigation 最穩 |
| Email 用 Resend fetch | 無套件依賴 | 無伺服器環境友好；未設定 key 時 graceful skip |
| 客戶 schema 沒有 contact/phone/email | 留給 `customer_contacts` table | 多聯絡人比 1:1 欄位有彈性 |
| 產業 12 類強約束 | CHECK constraint | 統一報表分群；前端別名映射處理輸入差異 |
| 客戶名稱沒有 UNIQUE 約束 | 故意 | 不同分公司可能同名；衝突檢查交給匯入流程 |

---

## 12. 邏輯思維評估模組

獨立的測驗活動模組，給 HR 對員工發放問卷。**不與 CRM 共用 users 表**——受測者可以是任何登泰夥伴（含非系統使用者），透過 HR 產生的公開連結作答。

### 12.1 員工作答（免登入）

**`/assess/[code]`**——middleware 已把 `/assess` 加入 publicPaths，任何人有連結都能進。流程：
1. Step 1：填寫姓名、部門（下拉選單）、員工編號（選填）
2. Step 2：20 題單選（每題 4 個選項），每題可隨時返回修改、進度自動暫存（status='in_progress'）
3. Step 3：20 題答完才能送出 → server 計分、寫 `completed`
4. Step 4：個人報告頁——總分、各類別 BarChart、等級（優秀 ≥80% / 良好 ≥60% / 中等 ≥40% / 待加強）、各類別解讀
5. 防重複：同一活動 + 姓名 + 部門已有 `completed` → 顯示「已完成此測驗」（DB partial unique index + API 雙重檢查）
6. 活動停用 / 過 deadline → 顯示「測驗已結束」

### 12.2 題庫單一來源

**`src/data/logic-test.json`** — 20 題 + 5 類別 + 計分規則 + 等級門檻 + 各類別 × 各等級的解讀文字，全部寫在這支 JSON。

| 類別 | 題數 |
|------|------|
| 數字序列（數量推理） | 5 |
| 文字推理（語文邏輯） | 5 |
| 條件推斷（演繹推理） | 5 |
| 規律辨識 | 3 |
| 情境判斷（實務判斷） | 2 |

每題：`id` / `category` / `difficulty` / `question` / `options[4]` / `answer`（0-3）/ `explanation`。

### 12.3 五版本防舞弊（seeded shuffle）

每位受測者隨機分配版本 **A / B / C / D / E**，**題目順序與每題的選項順序都會被打亂**（同版本 + 同 event_code 永遠產生相同打亂）。

實作位置：
- `src/lib/seeded-random.ts`：`mulberry32` + FNV-1a `seedFromString` + `seededShuffle`
- `src/lib/logic-test-shuffle.ts`：依 `(event_code, version)` 推出題序與每題的選項 permutation
- `src/lib/logic-test-scoring.ts`：拿 permutation **反推使用者點到的「打亂後 index」對應的原始選項 index**，再與 `answer` 欄位比對

關鍵：**`logic_answers` 儲存的是「使用者點到的打亂後 index」**，正解永遠不外洩給 client；只有 server 知道 permutation。所以即使有人開 DevTools 抓 network、抓 client bundle、共享答案——五個版本的「正確答案位置」都不同，沒有舞弊空間。

### 12.4 HR 後台

限 `admin` / `director`（在 schema 中即等於 HR 角色，由 `is_hr_role()` SECURITY DEFINER 函式控制）。

- **`/admin/assessments`**：列出所有活動 + 完成 / 進行中人數；「建立新活動」開 modal 填名稱與截止日期 → 系統自動產 8 位英數 `code`（去掉易混淆字元 `I/O/0/1`）→ 顯示可一鍵複製的完整連結；「停用 / 啟用」切換 `is_active`
- **`/admin/assessments/[id]`**：列出該活動已完成的所有 submission（姓名 / 部門 / 版本 / 總分 / 各類別等級 / 完成時間），可依部門篩選；點「查看 →」開 modal 顯示完整個人報告（`LogicTestReport` 元件與受測者看到的同一份）
- **匯出 Excel**：沿用 `xlsx` (SheetJS)，每人一列含姓名 / 部門 / 員工編號 / 版本 / 總分 / 各類別原始分 + 等級 / 完成時間

### 12.5 資料表

| Table | 用途 | 重要欄位 |
|-------|------|---------|
| `assessment_events` | HR 建立的測驗活動 | `code`（公開連結用、UNIQUE）、`name`、`test_types`（JSONB，目前固定 `["logic"]`）、`deadline`、`is_active`、`created_by` |
| `assessment_submissions` | 受測者作答紀錄 | `event_id`、`respondent_name`、`department`、`employee_code`、`version`（A-E）、`logic_answers`（JSONB：題號 → 打亂後選項 index）、`logic_scores`（JSONB：總分 / 各類別 / 等級）、`status`、`started_at`、`completed_at`、`ip_address` |

**索引**：
- `assessment_events(code)`、`assessment_events(is_active, deadline)`
- `assessment_submissions(event_id)`、`(status)`、`(completed_at) WHERE status='completed'`
- **`UNIQUE(event_id, respondent_name, department) WHERE status='completed'`**——防同人同部門重複完成的 partial unique index

### 12.6 RLS

`is_hr_role()` SECURITY DEFINER 函式回傳 `auth.uid()` 的人是不是 admin/director 且在職。

- `assessment_events`：SELECT / INSERT / UPDATE 全部限 `is_hr_role()`
- `assessment_submissions`：
  - SELECT：限 `is_hr_role()`（HR 才看得到提交內容）
  - INSERT：`TO anon, authenticated WITH CHECK (true)`（公開作答必要；前端走 server-side API + service_role）
  - UPDATE：限 `is_hr_role()`（受測者的續答都走 service_role API，不直連 client SDK）

> ⚠️ 公開 anon INSERT 是必要設計，但所有寫入實際上都走 Next.js API route + service_role key，這條 anon policy 只是 fallback。

### 12.7 重要設計決策

| 主題 | 決定 | 為什麼 |
|------|------|--------|
| 受測者不需登入 | 公開 code + middleware 排除 `/assess` | 對外發 link 即測，不必先註冊 |
| 答案儲存「打亂後 index」 | client 無從反推正解 | 五版本打亂是防舞弊核心；client 只知道自己看到什麼，server 才知道對應原始答案 |
| 計分在 server 跑 | 防 client 改分 | scoring util 純函式，與 shuffle util 共用同一份種子邏輯 |
| 防重複用 partial unique index | DB 層強制 + API 雙重檢查 | 同人同部門一個活動只能完成一次 |
| `assessment_events.code` 8 位英數 | 去掉 `I O 0 1` 易混淆字元 | 對 LINE 等手機輸入友善；碰撞重試最多 10 次 |
| 部門寫死在公開頁 | 業務 / 物流 / 報關 / 財務 / 管理 / 電商 / 其他 | 受測者可能來自非 CRM 的部門，不從 `users.team` 取 |

---

## 13. 已知限制 / 待辦

### 🔴 緊急（7/15 死線）
- [ ] **回填 1,111 筆客戶真實建檔日期**：目前全部為 2026-04-16，7/15 會同時觸發 90 天黃燈導致規則失效。需從 Notion CSV 匯出檔取得原始日期，透過 Supabase SQL Editor 批次更新。

### 🟠 高優先
- [ ] 通知系統：改為手動標記已讀（目前進頁面自動全部已讀）
- [ ] 客戶列表分頁（目前一次載入 1,111 筆，建議每頁 20 筆）
- [ ] 產業分類 & 上市櫃股票代碼補值（`scripts/import-customers.mjs` 已建立）
- [ ] migration 009 / 010 尚未 commit（目前 untracked）

### 🟡 中優先
- [ ] Email 通知啟用（Resend 已實作，需在 Vercel 設定環境變數）
- [ ] 介宏系統同步（已成交客戶自動同步）
- [ ] 客戶搜尋改為 Supabase 全文搜尋（`ilike` 或 `pg_trgm`）
- [ ] `customer_contacts` 沒有頁面操作 UI
- [ ] `status=locked` 時前端沒有明確提示原因（只顯示「儲存失敗」）

### 🟢 長期規劃
- [ ] Telegram Bot 完整邏輯（物流/報關模組，對接 Rob 機器人）
- [ ] 管理員數據儀表板
- [ ] audit log UI（目前需直接查 Supabase）

---

## 14. 最近重大變更（手動維護）

| Commit | 日期 | 摘要 |
|--------|------|------|
| `d7f4cee` | 2026-06-09 | **邏輯思維評估模組**：免登入 `/assess/[code]` 公開作答、五版本 seeded shuffle 防舞弊、`/admin/assessments` HR 後台（建立 / 列表 / 匯出 Excel）、`assessment_events` + `assessment_submissions` 兩張表（migration 019） |
| `f169a58` | 2026-06-09 | 移除 PP&E 與 Big Five 人格測驗模組（保留 migration 018 與 DB 表） |
| `4b1a142` | 2026-06-02 | `admin_soft_delete_customer()` RPC（修 PostgREST RETURNING + RLS 衝突）；migration 017 |
| `8eeab05` | 2026-06-02 | 5 個列表頁加分頁迴圈解除 1000 筆上限（`/customers` 主列表等） |
| `955e9c4` | 2026-05-15 | 第 4 道防線：RLS 全面加 `is_active_user()` 檢查；migration 015 |
| `6b0d47b` | 2026-05-15 | 離職員工 3 道防線（middleware + auth-context + Supabase Auth ban） |
| `3c69c8c` | 2026-05-14 | Realtime 即時同步（migration 014）+ 負責業務本人可管理聯絡人（migration 013） |
| `861778d` | 2026-05-13 | 客戶軟刪除（migration 012）+ 重複客戶清理頁 `/admin/duplicates` |
| `8be824a` | 2026-05-12 | 系統更名 Draco CRM → Draco LOP |
| `8812f70` | 2026-05-12 | 客戶匯入支援「整批標記為已成交」checkbox |
| `待補` | 2026-04-30 | 聯絡人 UI、通知手動已讀、鎖檔原因顯示、migration 011 收緊聯絡人寫入權限 |
| `4a3b8a3` | 2026-04-30 | 客戶列表載入優化：移除 comments 全撈、聯絡人改 server 端 count |
| `7d736e7` | 2026-04-30 | 補 commit migration 009/010、Python 匯入腳本、transfers 同課別審核 |
| `0059fc1` | 2026-04-30 | 新增 PROJECT_OVERVIEW.md |
| `9eb1c0c` | 2026-04-30 | 重新指派客戶後 90 天倒數正確重設，cron 不再被舊紀錄卡住 |
| `642025d` | 2026-04-29 | `/admin/import` 改寫為 CSV/Excel 三步驟匯入 |
| `ecac45e` | 2026-04-29 | 登出改用 server route + HTML anchor，徹底繞開 client JS |
| `587ea86` | 2026-04-29 | 24 小時自動登出 |
| `5fd027a` | 2026-04-28 | 客戶編輯權限修正 + 完成度判斷調整 |
| `3499c7a` | 2026-04-27 | 管理員多分頁 Excel 匯出 + 客戶詳情權限控管 |

> **更新規則**：每個合進 main 的功能性 commit（feat / fix）請更新此區塊；純文檔/部署觸發 commit（chore）可省略。
