"""
DRACO 客戶 Excel → CRM 匯入 CSV 轉換
讀取 ~/Desktop/DRACO 客戶.xlsx，輸出 ~/Desktop/客戶匯入清單.csv
"""
import csv
import json
import os
import re
import subprocess
from collections import Counter
from datetime import date

import openpyxl

SRC = os.path.expanduser("~/Desktop/DRACO 客戶.xlsx")
DST = os.path.expanduser("~/Desktop/客戶匯入清單.csv")
TODAY = date.today().isoformat()


def load_known_sales() -> set[str]:
    """從 live Supabase 撈取目前 users.chinese_name（is_active=true）。"""
    env_path = os.path.join(os.path.dirname(__file__), "..", ".env.local")
    env = {}
    with open(env_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k] = v.strip().strip('"').strip("'")
    url = env["NEXT_PUBLIC_SUPABASE_URL"]
    key = env["SUPABASE_SERVICE_ROLE_KEY"]
    result = subprocess.run(
        [
            "curl", "-s",
            f"{url}/rest/v1/users?select=chinese_name&is_active=eq.true",
            "-H", f"apikey: {key}",
            "-H", f"Authorization: Bearer {key}",
        ],
        capture_output=True, text=True, check=True, timeout=15,
    )
    data = json.loads(result.stdout)
    return {row["chinese_name"] for row in data if row.get("chinese_name")}


KNOWN_SALES = load_known_sales()

# Excel 的姓名若與 DB 有異體字差異，在此建立對照（左 = Excel，右 = DB）
NAME_ALIASES: dict[str, str] = {}

# (關鍵字 tuple, 產業類別) — 順序重要，先比對的優先
INDUSTRY_RULES = [
    (("電子", "半導體", "晶片", "科技", "光電", "電路", "IC", "電機", "資訊", "通訊", "網路", "系統"), "電子科技業"),
    (("機械", "工具機", "自動化", "機具", "機電", "機床", "工業"), "機械製造業"),
    (("化工", "塑膠", "原料", "樹脂", "化學", "橡膠", "樹膠"), "化工原物料"),
    (("紡織", "成衣", "布料", "纖維", "織造"), "紡織成衣業"),
    (("食品", "飲料", "餐飲", "食", "烘焙", "茶", "咖啡", "烘", "肉品", "糖"), "食品飲料業"),
    (("醫療", "藥品", "生技", "醫藥", "製藥", "生物", "保健", "診所", "醫院"), "醫療保健業"),
    (("汽車", "車業", "輪胎", "機車", "汽機車"), "汽車零組件"),
    (("貿易", "進出口", "國際", "外貿", "實業"), "貿易進出口"),
    (("電商", "零售", "購物", "百貨", "商城", "超市"), "電商零售業"),
    (("建材", "五金", "裝潢", "水電", "衛浴", "磁磚", "石材", "木業"), "建材五金業"),
    (("能源", "環保", "太陽能", "綠能", "再生", "光能", "節能"), "能源環保業"),
]

# 台灣知名上市櫃公司對照（公司名關鍵字 → (代號, 類型)）
# 僅列入可由公司名稱明確識別的大型公司，避免誤判
TAIWAN_STOCKS = {
    "台積電": ("2330", "上市"),
    "台灣積體電路": ("2330", "上市"),
    "鴻海": ("2317", "上市"),
    "聯發科": ("2454", "上市"),
    "聯電": ("2303", "上市"),
    "日月光": ("3711", "上市"),
    "台達電": ("2308", "上市"),
    "台塑": ("1301", "上市"),
    "南亞": ("1303", "上市"),
    "台化": ("1326", "上市"),
    "中鋼": ("2002", "上市"),
    "中華電": ("2412", "上市"),
    "台灣大哥大": ("3045", "上市"),
    "遠傳": ("4904", "上市"),
    "統一企業": ("1216", "上市"),
    "統一超": ("2912", "上市"),
    "大立光": ("3008", "上市"),
    "華碩": ("2357", "上市"),
    "宏碁": ("2353", "上市"),
    "廣達": ("2382", "上市"),
    "仁寶": ("2324", "上市"),
    "緯創": ("3231", "上市"),
    "和碩": ("4938", "上市"),
    "國巨": ("2327", "上市"),
    "瑞昱": ("2379", "上市"),
    "群創": ("3481", "上市"),
    "友達": ("2409", "上市"),
    "可成": ("2474", "上市"),
    "研華": ("2395", "上市"),
    "裕隆": ("2201", "上市"),
    "和泰車": ("2207", "上市"),
    "正新": ("2105", "上市"),
    "遠東新": ("1402", "上市"),
    "長榮": ("2603", "上市"),
    "陽明": ("2609", "上市"),
    "萬海": ("2615", "上市"),
    "富邦金": ("2881", "上市"),
    "國泰金": ("2882", "上市"),
    "中信金": ("2891", "上市"),
    "玉山金": ("2884", "上市"),
}


def detect_industry(name: str) -> str:
    for keywords, industry in INDUSTRY_RULES:
        for kw in keywords:
            if kw in name:
                return industry
    return "其他"


def detect_stock(name: str) -> tuple[str, str]:
    """回傳 (公司代號, 公司類型)；找不到回傳 ('', '一般公司')。"""
    for keyword, (code, code_type) in TAIWAN_STOCKS.items():
        if keyword in name:
            return code, code_type
    return "", "一般公司"


def clean_company_name(raw: str) -> str:
    return re.sub(r"\s+", "", str(raw).strip())


def main() -> None:
    wb = openpyxl.load_workbook(SRC, data_only=True)
    ws = wb["Page1"]

    rows = list(ws.iter_rows(values_only=True))[1:]  # 跳過表頭

    out_rows = []
    industry_count = Counter()
    sales_count = Counter()
    unknown_sales = Counter()
    stock_hits = 0

    for r in rows:
        _, company_raw, sales_raw = r[0], r[1], r[2]
        if not company_raw:
            continue
        company = clean_company_name(company_raw)
        sales = str(sales_raw).strip() if sales_raw else ""
        sales = NAME_ALIASES.get(sales, sales)

        industry = detect_industry(company)
        stock_code, company_type = detect_stock(company)

        if stock_code:
            stock_hits += 1

        industry_count[industry] += 1
        sales_count[sales] += 1
        if sales and sales not in KNOWN_SALES:
            unknown_sales[sales] += 1

        out_rows.append({
            "公司名稱": company,
            "負責業務": sales,
            "客戶等級": "C",
            "產業類別": industry,
            "公司類型": company_type,
            "公司代號": stock_code,
            "建檔日期": TODAY,
            "狀態": "開發中",
        })

    fieldnames = ["公司名稱", "負責業務", "客戶等級", "產業類別",
                  "公司類型", "公司代號", "建檔日期", "狀態"]

    with open(DST, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(out_rows)

    # 統計輸出
    print(f"\n✅ CSV 已輸出：{DST}")
    print(f"   總筆數：{len(out_rows)} 筆")

    print("\n📊 產業分布：")
    for ind, cnt in industry_count.most_common():
        bar = "█" * max(1, cnt * 40 // max(industry_count.values()))
        print(f"   {ind:<10} {cnt:>4} {bar}")

    print(f"\n🏢 上市櫃公司代號命中：{stock_hits} 筆")

    print("\n👤 負責業務分布：")
    for s, cnt in sales_count.most_common():
        mark = "" if s in KNOWN_SALES else "  ⚠️ (系統中無此帳號)"
        print(f"   {s:<6} {cnt:>4}{mark}")

    if unknown_sales:
        print(f"\n⚠️  共 {len(unknown_sales)} 位業務在 CRM 系統中不存在，"
              f"涉及 {sum(unknown_sales.values())} 筆客戶：")
        for s, cnt in unknown_sales.most_common():
            print(f"      {s} ({cnt} 筆)")

    print("\n🔍 前 5 筆範例：")
    for row in out_rows[:5]:
        print(f"   • {row['公司名稱']} | {row['負責業務']} | "
              f"{row['產業類別']} | {row['公司類型']}"
              + (f" {row['公司代號']}" if row['公司代號'] else ""))


if __name__ == "__main__":
    main()
