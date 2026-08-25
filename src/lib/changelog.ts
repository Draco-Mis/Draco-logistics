// ===================================================
// 版本與更新內容（What's New）
// 更新時：把 APP_VERSION 改新，並在 CHANGELOG 最前面加一筆。
// 登入後若使用者尚未看過此版本，會自動跳出更新公告。
// ===================================================

export const APP_VERSION = '2026.07.13'
export const APP_VERSION_LABEL = '2026 年 7 月更新總覽'

export interface ChangelogItem {
  emoji: string
  title: string
  desc: string
}

export interface ChangelogEntry {
  version: string
  label: string
  date: string
  items: ChangelogItem[]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '2026.07.13',
    label: APP_VERSION_LABEL,
    date: '2026/07',
    items: [
      { emoji: '🌌', title: '全新深色科技感主題', desc: '深藍黑底 + 霓虹光暈、玻璃態卡片、發光數字的「戰情室」風格。可切回日間。' },
      { emoji: '🟢', title: '目前線上人數', desc: '即時顯示現在有誰在線上（側邊欄、儀表板、手機頂列）。' },
      { emoji: '🎯', title: '跟進待辦 + 到期提醒', desc: '客戶可設「下一步 + 到期日」，到期自動提醒；儀表板有「待跟進」清單。' },
      { emoji: '⭐', title: '主管推薦優先開發', desc: '主管把客戶標為優先，該客戶會置頂在業務名單最前面並通知他。' },
      { emoji: '🗑️', title: '客戶刪除審核', desc: '業務可申請刪除客戶，送課長審核核准後才會移除。' },
      { emoji: '🧑‍💼', title: '新增副課長角色', desc: '副課長可在業績/報表看到同課組員的客戶（不含課長）。' },
      { emoji: '🧰', title: '批次調整升級', desc: '一次批次修改多筆客戶的等級、負責人、狀態。' },
      { emoji: '📊', title: '轉換漏斗 + 每月月報', desc: '儀表板開發→洽談→成交漏斗；每月自動月報摘要。' },
      { emoji: '🔔', title: '通知紅點 + ⌘K 搜尋', desc: '未讀通知即時紅點；⌘K 快速搜尋客戶、測驗活動與頁面。' },
      { emoji: '↩️', title: '可復原 + 一鍵今日聯絡', desc: '刪除/紀錄聯絡後可即時復原；一鍵把最後聯絡日設為今天。' },
      { emoji: '⚡', title: '更快更穩 + 體驗優化', desc: '清單載入加速、錯誤防呆、換頁進度條、動效、成交彩帶、加入主畫面。' },
    ],
  },
  {
    version: '2026.07.12',
    label: '2026 年 7 月・新功能更新',
    date: '2026/07/12',
    items: [
      { emoji: '🎯', title: '跟進待辦 + 到期提醒', desc: '客戶可設「下一步 + 到期日」，到期自動提醒；儀表板也有「待跟進」清單。' },
      { emoji: '⭐', title: '主管推薦優先開發', desc: '主管把客戶標為優先，該客戶會置頂在業務名單最前面並通知他。' },
      { emoji: '🗑️', title: '客戶刪除審核', desc: '業務可申請刪除客戶，送課長審核核准後才會移除。' },
      { emoji: '🧑‍💼', title: '新增副課長角色', desc: '副課長可在業績/報表看到同課組員的客戶（不含課長）。' },
      { emoji: '🧰', title: '批次調整升級', desc: '可一次批次修改多筆客戶的等級、負責人、狀態。' },
      { emoji: '📊', title: '轉換漏斗 + 每月月報', desc: '儀表板新增開發→洽談→成交漏斗；每月自動月報摘要。' },
      { emoji: '↩️', title: '操作可復原 + 一鍵今日聯絡', desc: '刪除/紀錄聯絡後可即時復原；客戶頁與清單一鍵記錄今日聯絡。' },
      { emoji: '🔍', title: '搜尋與清單優化', desc: '⌘K 也能搜測驗活動；客戶列表記住上次篩選、顯示篩選標籤。' },
      { emoji: '✨', title: '整體體驗優化', desc: '換頁進度條、數字動畫、成交彩帶、加入主畫面、錯誤保護頁。' },
    ],
  },
  {
    version: '2026.07',
    label: '2026 年 7 月更新',
    date: '2026/07',
    items: [
      { emoji: '🔔', title: '未讀通知紅點', desc: '側邊欄、手機底部與頂部都會即時顯示未讀數。' },
      { emoji: '🔍', title: '⌘K 快速搜尋', desc: '按 ⌘K / Ctrl+K 直接搜尋客戶或跳到任何頁面。' },
      { emoji: '💬', title: '操作即時回饋', desc: '儲存、刪除等動作改用精緻的提示與確認視窗，不再是生硬的系統彈窗。' },
      { emoji: '📇', title: '員工名冊升級', desc: '新增「單位」欄位，職稱可直接編輯，並附常用建議。' },
      { emoji: '👤', title: '使用者管理顯示職稱', desc: '每位使用者會帶出名冊職稱；新增「副課長」角色。' },
      { emoji: '📊', title: '副課長檢視權限', desc: '副課長可在業績/報表看到同課組員的客戶（不含課長）。' },
      { emoji: '✨', title: '介面體驗優化', desc: '全站載入動畫、空狀態、手機頁面標題與返回鍵。' },
    ],
  },
]

export function currentChangelog(): ChangelogEntry {
  return CHANGELOG.find(c => c.version === APP_VERSION) || CHANGELOG[0]
}
