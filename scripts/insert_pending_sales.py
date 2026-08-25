"""
批次插入 9 位新同事到 users 表
執行前請確認已套用 migration 010_expand_team_values.sql
"""
import json
import os
import subprocess
import sys

NEW_USERS = [
    # (chinese_name, english_name, email, team)
    ("陳立峻", "Allen",   "allen.chen-kh@dracolog.com",   "物流二部空運課"),
    ("許嘉真", "Nancy",   "nancy.hsu-kh@dracolog.com",    "物流一部遠洋課"),
    ("劉淯忻", "Cindy",   "cindy.liu-kh@dracolog.com",    "物流二部空運課"),
    ("朱晴卉", "Minnie",  "minnie.chu-kh@dracolog.com",   "物流一部大陸課"),
    ("林鈺靜", "Tobey",   "tobey.lin-kh@dracolog.com",    "物流一部大陸進口課"),
    ("張玉琴", "Teresa",  "teresa.chang-kh@dracolog.com", "物流一部大陸進口課"),
    ("童筠晰", "Cindy",   "cindy.tung-kh@dracolog.com",   "電商課"),
    ("羅薏雯", "Nina",    "nina.lo-kh@dracolog.com",      "物流二部三角課"),
    ("黃小菁", "Erica",   "erica-tc@seal-gb.com",          "崧盛"),
]


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


def main() -> None:
    env = load_env()
    url = env["NEXT_PUBLIC_SUPABASE_URL"]
    key = env["SUPABASE_SERVICE_ROLE_KEY"]

    payload = [
        {
            "email": email,
            "name": name,
            "chinese_name": cn,
            "role": "sales",
            "team": team,
            "is_active": True,
        }
        for cn, name, email, team in NEW_USERS
    ]

    result = subprocess.run(
        [
            "curl", "-s",
            "-X", "POST",
            f"{url}/rest/v1/users",
            "-H", f"apikey: {key}",
            "-H", f"Authorization: Bearer {key}",
            "-H", "Content-Type: application/json",
            "-H", "Prefer: return=representation",
            "-d", json.dumps(payload),
        ],
        capture_output=True, text=True, timeout=15,
    )

    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        print("❌ 回應解析失敗:", result.stdout)
        sys.exit(1)

    if isinstance(data, dict) and data.get("code"):
        print(f"❌ 插入失敗 [{data.get('code')}]: {data.get('message')}")
        if data.get("details"):
            print(f"   詳細: {data['details']}")
        sys.exit(1)

    print(f"✅ 成功新增 {len(data)} 位 users：")
    for row in data:
        print(f"   {row['chinese_name']} ({row['name']}) | {row['team']} | {row['email']}")


if __name__ == "__main__":
    main()
