-- 英语口语真人匹配平台 — SQLite 初始化脚本
-- 与 ARCHITECTURE.md 保持一致；迁移时请版本化

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone VARCHAR(20) UNIQUE,
  email VARCHAR(120) UNIQUE,
  nickname VARCHAR(50) NOT NULL,
  credit_score INTEGER NOT NULL DEFAULT 10,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS themes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  difficulty_level VARCHAR(20) DEFAULT 'intermediate',
  task_card_a TEXT,
  task_card_b TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS timeslots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  theme_id INTEGER NOT NULL,
  start_time DATETIME NOT NULL,
  end_time DATETIME NOT NULL,
  max_pairs INTEGER NOT NULL DEFAULT 5,
  booked_count INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  FOREIGN KEY (theme_id) REFERENCES themes(id)
);

CREATE INDEX IF NOT EXISTS idx_timeslots_theme_start ON timeslots(theme_id, start_time);
CREATE INDEX IF NOT EXISTS idx_timeslots_start ON timeslots(start_time);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  timeslot_id INTEGER NOT NULL,
  level VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'confirmed',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (timeslot_id) REFERENCES timeslots(id),
  UNIQUE(user_id, timeslot_id)
);

CREATE INDEX IF NOT EXISTS idx_bookings_timeslot ON bookings(timeslot_id, status);

CREATE TABLE IF NOT EXISTS pairs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timeslot_id INTEGER NOT NULL,
  user_a INTEGER NOT NULL,
  user_b INTEGER NOT NULL,
  channel_name VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (timeslot_id) REFERENCES timeslots(id),
  FOREIGN KEY (user_a) REFERENCES users(id),
  FOREIGN KEY (user_b) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_pairs_timeslot ON pairs(timeslot_id);

CREATE TABLE IF NOT EXISTS credit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  change INTEGER NOT NULL,
  reason VARCHAR(100),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_credit_logs_user ON credit_logs(user_id);
