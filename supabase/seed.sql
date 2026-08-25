-- =============================================
-- 初始使用者資料
-- 注意：執行前需要先在 Supabase Auth 建立對應帳號
-- 下方的 UUID 為預設值，部署時請替換為實際 Auth UID
-- =============================================

-- 先建立 Auth 帳號後，用以下 SQL 插入 users 資料
-- 請將 id 替換為 Supabase Auth 產生的 UUID

INSERT INTO users (id, email, name, chinese_name, role, team) VALUES
  (gen_random_uuid(), 'hans@draco.com', 'Hans', '許宏誌', 'admin', '業一課'),
  (gen_random_uuid(), 'reina@draco.com', 'Reina', '莊采妮', 'manager', '業一課'),
  (gen_random_uuid(), 'may@draco.com', 'May', '吳秀美', 'manager', '業二課'),
  (gen_random_uuid(), 'aaron@draco.com', 'Aaron', '楊家豪', 'sales', '專案課'),
  (gen_random_uuid(), 'vera@draco.com', 'Vera', '葉怡君', 'sales', '專案課'),
  (gen_random_uuid(), 'andy@draco.com', 'Andy', '王洪仁', 'sales', '專案課'),
  (gen_random_uuid(), 'jill@draco.com', 'Jill', '林芝亘', 'sales', '業一課'),
  (gen_random_uuid(), 'oscar@draco.com', 'Oscar', '洪海洲', 'sales', '業一課'),
  (gen_random_uuid(), 'rex@draco.com', 'Rex', '王家偉', 'sales', '業一課'),
  (gen_random_uuid(), 'kenny@draco.com', 'Kenny', '蔡煊霖', 'sales', '業一課'),
  (gen_random_uuid(), 'brad@draco.com', 'Brad', '邱德晏', 'sales', '業一課'),
  (gen_random_uuid(), 'max@draco.com', 'Max', '王家晟', 'sales', '業二課'),
  (gen_random_uuid(), 'sophie@draco.com', 'Sophie', '陳品儒', 'sales', '業二課'),
  (gen_random_uuid(), 'leo@draco.com', 'Leo', '洪樂', 'sales', '業二課'),
  (gen_random_uuid(), 'grace@draco.com', 'Grace', '黃彥涵', 'sales', '業二課'),
  (gen_random_uuid(), 'jumbo@draco.com', 'Jumbo', '郭家圻', 'sales', '業二課'),
  (gen_random_uuid(), 'chris@draco.com', 'Chris', '周見昕', 'sales', '業二課');
