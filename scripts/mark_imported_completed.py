"""
將剛剛批次匯入的 268 筆客戶標記為「已成交」狀態
- UPDATE customers SET status = 'completed'
- INSERT customer_history (mark_completed)
"""
import json
import os
import subprocess
import sys

ADMIN_EMAIL = "hans@dracolog.com"
# 批次匯入時間戳（從先前查詢結果確認 04:07:05 同秒）
IMPORT_TS_LOWER = "2026-04-24T04:07:00"
IMPORT_TS_UPPER = "2026-04-24T04:07:30"


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
    return subprocess.run(cmd, capture_output=True, text=True, timeout=60).stdout


def main(dry_run: bool) -> None:
    env = load_env()
    url = env["NEXT_PUBLIC_SUPABASE_URL"]
    key = env["SUPABASE_SERVICE_ROLE_KEY"]

    # 1. 找 admin id
    admin = json.loads(curl_json(
        "GET",
        f"{url}/rest/v1/users?select=id,chinese_name&email=eq.{ADMIN_EMAIL}",
        key,
    ))
    if not admin:
        print(f"❌ 找不到 admin {ADMIN_EMAIL}")
        sys.exit(1)
    admin_id = admin[0]["id"]
    admin_name = admin[0]["chinese_name"]

    # 2. 找這次批次匯入的客戶
    target = json.loads(curl_json(
        "GET",
        f"{url}/rest/v1/customers?select=id,company_name,status"
        f"&created_at=gte.{IMPORT_TS_LOWER}"
        f"&created_at=lte.{IMPORT_TS_UPPER}"
        f"&created_by=eq.{admin_id}",
        key,
    ))
    print(f"🎯 鎖定 {len(target)} 筆批次匯入的客戶")

    # 統計現況
    from collections import Counter
    print(f"   目前狀態分布: {dict(Counter(c['status'] for c in target))}")

    if len(target) != 268:
        print(f"⚠️  數量不是預期的 268 筆，請檢查時間範圍是否正確")
        if not dry_run:
            sys.exit(1)

    if dry_run:
        print("\n前 3 筆範例:")
        for c in target[:3]:
            print(f"   {c['company_name']} ({c['status']} → completed)")
        print("\n🟡 Dry-run 模式。重跑時加 --execute 即會更新。")
        return

    # 3. 批次 UPDATE customers.status = 'completed'
    BATCH = 50
    ids = [c["id"] for c in target]
    upd_ok = 0
    for i in range(0, len(ids), BATCH):
        chunk = ids[i:i+BATCH]
        in_clause = "(" + ",".join(chunk) + ")"
        resp = curl_json(
            "PATCH",
            f"{url}/rest/v1/customers?id=in.{in_clause}",
            key,
            {"status": "completed"},
        )
        try:
            data = json.loads(resp)
            if isinstance(data, dict) and data.get("code"):
                print(f"   ❌ 批次 {i//BATCH+1} 失敗: {data}")
                continue
            upd_ok += len(data)
            print(f"   批次 {i//BATCH+1}: UPDATE 成功 {len(data)} 筆")
        except json.JSONDecodeError:
            print(f"   ❌ 批次 {i//BATCH+1} 解析失敗: {resp[:200]}")

    print(f"\n✅ Customers UPDATE 完成：{upd_ok} 筆")

    # 4. 批次 INSERT customer_history
    history_payload = [
        {
            "customer_id": c["id"],
            "action_type": "mark_completed",
            "action_by": admin_id,
            "note": f"{admin_name} 將狀態由「開發中」改為「已成交」（批次匯入後標記）",
        }
        for c in target
    ]

    hist_ok = 0
    for i in range(0, len(history_payload), 100):
        chunk = history_payload[i:i+100]
        resp = curl_json("POST", f"{url}/rest/v1/customer_history", key, chunk)
        try:
            data = json.loads(resp)
            if isinstance(data, dict) and data.get("code"):
                print(f"   ❌ history 批次 {i//100+1} 失敗: {data}")
                continue
            hist_ok += len(data)
            print(f"   history 批次 {i//100+1}: 成功 {len(data)} 筆")
        except json.JSONDecodeError:
            print(f"   ❌ history 批次 {i//100+1} 解析失敗: {resp[:200]}")

    print(f"\n✅ History INSERT 完成：{hist_ok} 筆")


if __name__ == "__main__":
    main(dry_run="--execute" not in sys.argv)
