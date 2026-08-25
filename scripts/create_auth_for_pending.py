"""
為剛剛 INSERT 進 users 表但尚未建 Auth 帳號的 9 位同事建 Supabase Auth 帳號。
流程與 /admin/users ➕ 新增使用者 完全一致：
  - 統一密碼 Draco2026
  - email_confirm=true（不需點驗證信）
  - users.password_changed=false（首次登入強制改密碼）
  - Auth.id 對齊 users.id（讓 RLS auth.uid() 對得到）
"""
import json
import os
import subprocess
import sys

PENDING_EMAILS = [
    "allen.chen-kh@dracolog.com",
    "nancy.hsu-kh@dracolog.com",
    "cindy.liu-kh@dracolog.com",
    "minnie.chu-kh@dracolog.com",
    "tobey.lin-kh@dracolog.com",
    "teresa.chang-kh@dracolog.com",
    "cindy.tung-kh@dracolog.com",
    "nina.lo-kh@dracolog.com",
    "erica-tc@seal-gb.com",
]
TEMP_PASSWORD = "Draco2026"


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


def curl_json(method: str, url: str, key: str, body=None, extra_headers=None) -> str:
    cmd = [
        "curl", "-s", "-X", method, url,
        "-H", f"apikey: {key}",
        "-H", f"Authorization: Bearer {key}",
        "-H", "Content-Type: application/json",
    ]
    for h in (extra_headers or []):
        cmd += ["-H", h]
    if body is not None:
        cmd += ["-d", json.dumps(body, ensure_ascii=False)]
    return subprocess.run(cmd, capture_output=True, text=True, timeout=30).stdout


def main(dry_run: bool) -> None:
    env = load_env()
    url = env["NEXT_PUBLIC_SUPABASE_URL"]
    key = env["SUPABASE_SERVICE_ROLE_KEY"]

    # 1. 撈這 9 位的 users 列
    in_clause = "(" + ",".join(f'"{e}"' for e in PENDING_EMAILS) + ")"
    targets = json.loads(curl_json(
        "GET",
        f"{url}/rest/v1/users?select=id,email,name,chinese_name,password_changed&email=in.{in_clause}",
        key,
    ))
    print(f"📋 找到 {len(targets)}/{len(PENDING_EMAILS)} 位")

    # 2. 撈現有 Auth users 列表（避免重複建）
    auth_list = json.loads(curl_json(
        "GET",
        f"{url}/auth/v1/admin/users?per_page=200",
        key,
    ))
    existing_emails = {u["email"] for u in auth_list.get("users", [])}

    todo = []
    skipped = []
    for u in targets:
        if u["email"] in existing_emails:
            skipped.append(u)
        else:
            todo.append(u)

    print(f"   - 已有 Auth: {len(skipped)}")
    print(f"   - 待建 Auth: {len(todo)}")
    for u in todo:
        print(f"     • {u['chinese_name']} ({u['name']}) {u['email']}")

    if dry_run:
        print("\n🟡 Dry-run 模式，未執行。重跑時加 --execute 即會建立。")
        return

    if not todo:
        print("\n✅ 全部已有 Auth 帳號，無需處理")
        return

    # 3. 建 Auth 帳號 (id 對齊 users.id)
    success = 0
    for u in todo:
        body = {
            "id": u["id"],
            "email": u["email"],
            "password": TEMP_PASSWORD,
            "email_confirm": True,
            "user_metadata": {
                "chinese_name": u["chinese_name"],
                "name": u["name"],
            },
        }
        resp = curl_json("POST", f"{url}/auth/v1/admin/users", key, body)
        try:
            data = json.loads(resp)
        except json.JSONDecodeError:
            print(f"   ❌ {u['chinese_name']}: 回應解析失敗 {resp[:200]}")
            continue

        if data.get("id"):
            success += 1
            print(f"   ✅ {u['chinese_name']} ({u['email']}) Auth 已建立")
        else:
            print(f"   ❌ {u['chinese_name']}: {data.get('msg') or data.get('error_description') or data}")

    # 4. 確保 password_changed = false
    if success > 0:
        resp = curl_json(
            "PATCH",
            f"{url}/rest/v1/users?email=in.{in_clause}",
            key,
            {"password_changed": False},
            extra_headers=["Prefer: return=representation"],
        )
        try:
            updated = json.loads(resp)
            n = len(updated) if isinstance(updated, list) else 0
            print(f"\n🔐 password_changed=false 設定完成（{n} 列）")
        except json.JSONDecodeError:
            print(f"\n⚠️  password_changed 更新回應異常: {resp[:200]}")

    print(f"\n✅ 完成：{success}/{len(todo)} 位 Auth 帳號已建立")
    print(f"   通知對方：用 email + 密碼「{TEMP_PASSWORD}」登入，首次登入會強制改密碼")


if __name__ == "__main__":
    main(dry_run="--execute" not in sys.argv)
