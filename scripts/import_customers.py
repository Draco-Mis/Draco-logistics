"""
批次匯入客戶 CSV → Supabase customers 表
讀 ~/Desktop/客戶匯入清單.csv，透過 service role key 直接 POST
"""
import csv
import json
import os
import subprocess
import sys
from collections import Counter

CSV_PATH = os.path.expanduser("~/Desktop/客戶匯入清單.csv")
ADMIN_EMAIL = "hans@dracolog.com"

STATUS_MAP = {
    "開發中": "active_developing",
    "警示": "warning",
    "鎖檔": "locked",
    "重新開發": "reactivating",
}

CODE_TYPE_MAP = {
    "上市": "上市", "上櫃": "上櫃", "興櫃": "興櫃",
    "一般公司": "一般公司", "一般": "一般公司", "": None,
}

VALID_INDUSTRIES = {
    "電子科技業", "機械製造業", "化工原物料", "紡織成衣業",
    "食品飲料業", "醫療保健業", "汽車零組件", "貿易進出口",
    "電商零售業", "建材五金業", "能源環保業", "其他",
}


def load_env() -> dict:
    env = {}
    path = os.path.join(os.path.dirname(__file__), "..", ".env.local")
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k] = v.strip().strip('"').strip("'")
    return env


def curl_json(method: str, url: str, key: str, body=None) -> str:
    cmd = [
        "curl", "-s", "-X", method, url,
        "-H", f"apikey: {key}",
        "-H", f"Authorization: Bearer {key}",
        "-H", "Content-Type: application/json",
        "-H", "Prefer: return=representation",
    ]
    if body is not None:
        cmd += ["-d", json.dumps(body, ensure_ascii=False)]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    return r.stdout


def main(dry_run: bool) -> None:
    env = load_env()
    url = env["NEXT_PUBLIC_SUPABASE_URL"]
    key = env["SUPABASE_SERVICE_ROLE_KEY"]

    # 1. 撈 users (chinese_name -> id)
    users = json.loads(curl_json(
        "GET",
        f"{url}/rest/v1/users?select=id,chinese_name,email&is_active=eq.true",
        key,
    ))
    name_to_id = {u["chinese_name"]: u["id"] for u in users}
    admin_id = next((u["id"] for u in users if u["email"] == ADMIN_EMAIL), None)
    if not admin_id:
        print(f"❌ 找不到 admin {ADMIN_EMAIL}")
        sys.exit(1)

    # 2. 讀 CSV → 構造 payload
    payload = []
    missing = Counter()
    with open(CSV_PATH, encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            sales_name = row["負責業務"].strip()
            assigned_to = name_to_id.get(sales_name)
            if not assigned_to:
                missing[sales_name] += 1
                continue

            industry = row["產業類別"].strip()
            if industry not in VALID_INDUSTRIES:
                industry = None

            payload.append({
                "company_name": row["公司名稱"].strip(),
                "assigned_to": assigned_to,
                "created_date": row["建檔日期"],
                "status": STATUS_MAP.get(row["狀態"].strip(), "active_developing"),
                "grade": row["客戶等級"].strip() or "C",
                "company_code_type": CODE_TYPE_MAP.get(row["公司類型"].strip()),
                "company_code": row["公司代號"].strip() or None,
                "industry": industry,
                "created_by": admin_id,
            })

    print(f"📋 已映射 {len(payload)} 筆客戶（admin created_by = {admin_id[:8]}…）")
    if missing:
        print("⚠️ 仍有未對應的業務（不會匯入）:")
        for s, c in missing.most_common():
            print(f"   {s}: {c} 筆")

    print("\n前 3 筆 payload 範例:")
    for p in payload[:3]:
        print(f"   {json.dumps(p, ensure_ascii=False)}")

    if dry_run:
        print("\n🟡 Dry-run 模式，未執行插入。重跑時加 --execute 即會匯入。")
        return

    # 3. 分批 POST（每批 100）
    BATCH = 100
    total_ok, total_fail = 0, 0
    for i in range(0, len(payload), BATCH):
        chunk = payload[i:i+BATCH]
        resp = curl_json("POST", f"{url}/rest/v1/customers", key, chunk)
        try:
            data = json.loads(resp)
        except json.JSONDecodeError:
            print(f"❌ 批次 {i//BATCH+1} 回應解析失敗: {resp[:200]}")
            total_fail += len(chunk)
            continue
        if isinstance(data, dict) and data.get("code"):
            print(f"❌ 批次 {i//BATCH+1} 失敗 [{data.get('code')}]: {data.get('message')}")
            print(f"   詳細: {data.get('details')}")
            total_fail += len(chunk)
        else:
            total_ok += len(data)
            print(f"   批次 {i//BATCH+1}: 成功 {len(data)} 筆")

    print(f"\n✅ 匯入完成：成功 {total_ok} 筆，失敗 {total_fail} 筆")


if __name__ == "__main__":
    main(dry_run="--execute" not in sys.argv)
