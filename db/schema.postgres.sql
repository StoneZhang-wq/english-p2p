-- 英语口语真人匹配平台 — PostgreSQL 建表（与 ARCHITECTURE 对齐）
-- Railway / Neon 等：设置 DATABASE_URL 后由应用启动时执行（CREATE IF NOT EXISTS）

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  phone VARCHAR(20) UNIQUE,
  email VARCHAR(120) UNIQUE,
  nickname VARCHAR(50) NOT NULL,
  password_hash TEXT,
  credit_score INTEGER NOT NULL DEFAULT 10,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS themes (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  difficulty_level VARCHAR(20) DEFAULT 'intermediate',
  task_card_a TEXT,
  task_card_b TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  shanghai_week_monday DATE,
  theme_slot SMALLINT NOT NULL DEFAULT 0,
  slug VARCHAR(64),
  scene_text TEXT,
  roles_json TEXT,
  cover_url TEXT,
  preview_markdown TEXT,
  is_sandbox BOOLEAN NOT NULL DEFAULT FALSE,
  room_tasks_json JSONB,
  llm_generated_at TIMESTAMPTZ,
  llm_prompt_version TEXT
);

-- 周主题唯一索引见 backend/db.js migrateWeeklyThemesColumns（须在 ALTER 之后执行）

CREATE TABLE IF NOT EXISTS timeslots (
  id SERIAL PRIMARY KEY,
  theme_id INTEGER NOT NULL REFERENCES themes (id),
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP NOT NULL,
  max_pairs INTEGER NOT NULL DEFAULT 5,
  booked_count INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'open'
);

CREATE INDEX IF NOT EXISTS idx_timeslots_theme_start ON timeslots (theme_id, start_time);
CREATE INDEX IF NOT EXISTS idx_timeslots_start ON timeslots (start_time);

CREATE TABLE IF NOT EXISTS bookings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id),
  timeslot_id INTEGER NOT NULL REFERENCES timeslots (id),
  level VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'confirmed',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, timeslot_id)
);

CREATE INDEX IF NOT EXISTS idx_bookings_timeslot ON bookings (timeslot_id, status);

CREATE TABLE IF NOT EXISTS pairs (
  id SERIAL PRIMARY KEY,
  timeslot_id INTEGER NOT NULL REFERENCES timeslots (id),
  user_a INTEGER NOT NULL REFERENCES users (id),
  user_b INTEGER NOT NULL REFERENCES users (id),
  channel_name VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pairs_timeslot ON pairs (timeslot_id);

CREATE TABLE IF NOT EXISTS credit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id),
  change INTEGER NOT NULL,
  reason VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_credit_logs_user ON credit_logs (user_id);
