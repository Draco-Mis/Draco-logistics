-- =============================================
-- Migration 025: 員工名冊 DB table
-- 請在 Supabase SQL Editor 中執行此檔案
-- =============================================
--
-- 把員工資料從 JSON 搬到 DB，讓 HR 可以在 /admin/employees 直接編輯分類
-- 9 個分類：chairman / department_head / section_head / deputy_section_head /
--          supervisor / project_lead / operations / sales / staff

CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chinese_name TEXT NOT NULL,
  english_name TEXT,
  title TEXT,
  category TEXT NOT NULL CHECK (category IN (
    'chairman', 'department_head', 'section_head', 'deputy_section_head',
    'supervisor', 'project_lead', 'operations', 'sales', 'staff'
  )),
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employees_category ON employees(category);
CREATE INDEX IF NOT EXISTS idx_employees_sort ON employees(sort_order);

-- RLS：admin / chairman / director / hr / 管理部 都可讀寫
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION can_manage_employees()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
      AND is_active = true
      AND (
        role IN ('admin', 'chairman', 'director', 'hr')
        OR team = '管理部'
      )
  );
$$;

GRANT EXECUTE ON FUNCTION can_manage_employees() TO authenticated;

DROP POLICY IF EXISTS "employees_select" ON employees;
CREATE POLICY "employees_select" ON employees FOR SELECT TO authenticated
  USING (can_manage_employees());

DROP POLICY IF EXISTS "employees_insert" ON employees;
CREATE POLICY "employees_insert" ON employees FOR INSERT TO authenticated
  WITH CHECK (can_manage_employees());

DROP POLICY IF EXISTS "employees_update" ON employees;
CREATE POLICY "employees_update" ON employees FOR UPDATE TO authenticated
  USING (can_manage_employees())
  WITH CHECK (can_manage_employees());

DROP POLICY IF EXISTS "employees_delete" ON employees;
CREATE POLICY "employees_delete" ON employees FOR DELETE TO authenticated
  USING (can_manage_employees());

-- Seed 99 員工資料（與 src/data/employees.json 一致）
-- 若已有資料則跳過（不會覆蓋現有編輯）
INSERT INTO employees (chinese_name, english_name, title, category, sort_order)
SELECT * FROM (VALUES
  ('劉美蘭', 'Anna', '總經理', 'chairman', 1),
  ('陳昭伃', 'Apple', '副總經理', 'chairman', 2),
  ('宋建明', 'Ken', '資深經理', 'department_head', 3),
  ('許庭菀', 'Andrea', '副課長', 'deputy_section_head', 4),
  ('鄭宗庭', 'Ryan', '課長', 'section_head', 5),
  ('許宏誌', 'Hans', '協理', 'department_head', 6),
  ('楊家豪', 'Aaron', '專案課長', 'project_lead', 7),
  ('黃小菁', 'Erica', '副理', 'department_head', 8),
  ('柳育庭', 'Tina', '主任', 'supervisor', 9),
  ('吳秀美', 'May', '課長', 'section_head', 10),
  ('唐郁婷', 'Naomi', '副課長', 'deputy_section_head', 11),
  ('莊采妮', 'Reina', '課長', 'section_head', 12),
  ('范家豪', 'James', '課長', 'section_head', 13),
  ('石炫虎', 'Vincent', 'OP', 'operations', 14),
  ('王筱涵', 'Alice', '副課長', 'deputy_section_head', 15),
  ('陳雅淇', 'Penny', '主任', 'supervisor', 16),
  ('葉怡君', 'Vera', '專案副理', 'project_lead', 17),
  ('蔡其真', 'Iris', 'OP', 'operations', 18),
  ('刁祈文', 'Chivi', '副課長', 'deputy_section_head', 19),
  ('蔡維珊', 'Annie', '課長', 'section_head', 20),
  ('顏汎如', 'Flora', '主任', 'supervisor', 21),
  ('劉沛函', 'Hayley', '主任', 'supervisor', 22),
  ('田佳媛', 'Candy', '協理', 'department_head', 23),
  ('李姿逸', 'Yumi', '資深經理', 'department_head', 24),
  ('朱晴卉', 'Minnie', '課長', 'section_head', 25),
  ('莊蕙禎', 'Dora', '資深課長', 'section_head', 26),
  ('劉淯忻', 'Cindy', '資深課長', 'section_head', 27),
  ('許嘉真', 'Nancy', '資深課長', 'section_head', 28),
  ('張玉琴', 'Teresa', '課長', 'section_head', 29),
  ('陳季汝', 'Lulu', 'OP助理', 'operations', 30),
  ('錢致維', 'Tim', '資深經理', 'department_head', 31),
  ('陳紋慧', 'Sandy', 'OP', 'operations', 32),
  ('莊依琪', 'Soiki', 'OP', 'operations', 33),
  ('洪嘉琪', 'Joyce', '主任', 'supervisor', 34),
  ('陳冠宇', 'Roda', '主任', 'supervisor', 35),
  ('林芝亘', 'Jill', '專案課長', 'project_lead', 36),
  ('陳依瑩', 'Emma', '主任', 'supervisor', 37),
  ('李郁雅', 'Jenny', 'OP', 'operations', 38),
  ('王家晟', 'Max', '副課長', 'deputy_section_head', 39),
  ('熊橙希', 'Jonna', 'OP助理', 'operations', 40),
  ('黃嶺', 'David', '外務人員', 'staff', 41),
  ('陳品儒', 'Sophie', '主任', 'supervisor', 42),
  ('邱琬淇', 'Wiggy', 'OP', 'operations', 43),
  ('李芯慈', 'Jill', 'OP', 'operations', 44),
  ('許育慈', 'Jocelyn', 'OP', 'operations', 45),
  ('吳采菲', 'Lynn', 'OP助理', 'operations', 46),
  ('何其晉', 'Paul', 'OP助理', 'operations', 47),
  ('夏瑋聯', 'William', '外務人員', 'staff', 48),
  ('賴禹璇', 'Sherry', 'OP', 'operations', 49),
  ('曾郁恩', 'Ian', 'OP助理', 'operations', 50),
  ('呂培蜜', 'Mia', '櫃台人員', 'staff', 51),
  ('黃彥涵', 'Grace', '業務專員', 'sales', 52),
  ('胡欣慧', 'Emily', 'OP助理', 'operations', 53),
  ('蔡晏霏', 'Fanny', '櫃台人員', 'staff', 54),
  ('吳欣涵', 'Joan', '副課長', 'deputy_section_head', 55),
  ('陳立峻', 'Allen', 'OP助理', 'operations', 56),
  ('洪海洲', 'Oscar', '業務專員', 'sales', 57),
  ('曾芷珊', 'San', 'OP助理', 'operations', 58),
  ('李秀連', 'Rachel', '課長', 'section_head', 59),
  ('劉秀鳳', 'Sally', 'OP助理', 'operations', 60),
  ('蘇雲柔', 'Eva', '主任', 'supervisor', 61),
  ('陳姿勻', 'Karina', 'OP助理', 'operations', 62),
  ('郭慧亞', 'Jenny', 'OP助理', 'operations', 63),
  ('林彥欣', 'Ann', 'OP', 'operations', 64),
  ('吳映綺', 'Chloe', 'OP助理', 'operations', 65),
  ('莊淨婷', 'Green', '人資', 'staff', 66),
  ('王家偉', 'Rex', '業務專員', 'sales', 67),
  ('金宇浩', 'Jim', 'OP助理', 'operations', 68),
  ('蔡煊霖', 'Kenny', '業務專員', 'sales', 69),
  ('薛宇翔', 'Johnson', '外務人員', 'staff', 70),
  ('翁裴慈', 'Natalie', 'OP助理', 'operations', 71),
  ('童筠晰', 'Cindy', '跨境行銷專員', 'sales', 72),
  ('郭家圻', 'Jumbo', '業務專員', 'sales', 73),
  ('徐文昱', 'Yona', 'OP助理', 'operations', 74),
  ('盧怡辰', 'Olivia', 'OP', 'operations', 75),
  ('張慧汝', 'Jennifer', 'OP', 'operations', 76),
  ('林郁萱', 'Sandy', 'OP助理', 'operations', 77),
  ('丘珮瀅', 'Suki', '會計', 'staff', 78),
  ('王沛穎', 'Penny', '會計', 'staff', 79),
  ('翁婕恩', 'Winter', '外務人員', 'staff', 80),
  ('謝雯涵', 'Iris', 'OP助理', 'operations', 81),
  ('羅薏雯', 'Nina', 'OP', 'operations', 82),
  ('丁堉梓', 'Judith', '實習生', 'staff', 83),
  ('江珈虹', 'Janice', 'OP助理', 'operations', 84),
  ('廖于瑄', 'Hana', 'OP助理', 'operations', 85),
  ('林羿宏', 'Andy', '實習生', 'staff', 86),
  ('王洪仁', 'Andy', '專案課長', 'project_lead', 87),
  ('林晨楹', 'Chenying', 'OP助理', 'operations', 88),
  ('陳喆勳', 'Joy', '外務人員', 'staff', 89),
  ('周見昕', 'Chris', '業務專員', 'sales', 90),
  ('蔡昕婷', 'Stella', '駐廠人員', 'staff', 91),
  ('謝苗蒨', 'Avis', '實習生', 'staff', 92),
  ('王唯名', 'Max', '工程師', 'staff', 93),
  ('邱麗文', 'Reika', 'OP助理', 'operations', 94),
  ('洪詩涵', 'Wendy', 'OP助理', 'operations', 95),
  ('林裕恩', 'Peter', '外務人員', 'staff', 96),
  ('郭菡恬', 'Hanna', 'OP助理', 'operations', 97),
  ('蔡淑娜', 'Natty', 'OP助理', 'operations', 98),
  ('蔡慈芬', 'Anita', 'OP', 'operations', 99)
) AS v(chinese_name, english_name, title, category, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM employees);
