const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

let dbInstance;

function migrateUsersTable(db) {
  const cols = db.prepare("PRAGMA table_info(users)").all();
  if (!cols.length) return;
  if (!cols.some((c) => c.name === "password_hash")) {
    db.exec("ALTER TABLE users ADD COLUMN password_hash TEXT");
  }
}

/** 无场次时写入演示数据；主题名称与 /api/timeslots?theme= 解析表、首页文案一致。 */
function seedDemoIfEmpty(db) {
  if (db.prepare("SELECT COUNT(*) AS c FROM timeslots").get().c > 0) return;

  if (db.prepare("SELECT COUNT(*) AS c FROM themes").get().c === 0) {
    db.exec(`INSERT INTO themes (name, description, difficulty_level, is_active) VALUES
      ('职场面试', '模拟英文面试，讨论职业规划', 'intermediate', 1),
      ('雅思口语 Part 2', '随机抽取题库进行 2 分钟独白练习', 'intermediate', 1),
      ('日常闲聊', '轻松的话题，分享生活趣事', 'beginner', 1);`);
  }

  const ids = db
    .prepare("SELECT id FROM themes ORDER BY id LIMIT 3")
    .all()
    .map((r) => Number(r.id));
  if (ids.length < 3) return;

  const a = ids[0];
  const b = ids[1];
  const c = ids[2];
  db.exec(`INSERT INTO timeslots (theme_id, start_time, end_time, max_pairs, booked_count, status) VALUES
    (${a}, datetime('now', '+1 day'), datetime('now', '+1 day', '+1 hour'), 5, 0, 'open'),
    (${a}, datetime('now', '+1 day', '+2 hours'), datetime('now', '+1 day', '+3 hours'), 5, 0, 'open'),
    (${a}, datetime('now', '+2 day'), datetime('now', '+2 day', '+1 hour'), 5, 0, 'open'),
    (${b}, datetime('now', '+1 day', '+4 hours'), datetime('now', '+1 day', '+5 hours'), 3, 0, 'open'),
    (${b}, datetime('now', '+3 day'), datetime('now', '+3 day', '+1 hour'), 3, 0, 'open'),
    (${c}, datetime('now', '+2 day', '+3 hours'), datetime('now', '+2 day', '+4 hours'), 5, 0, 'open'),
    (${c}, datetime('now', '+4 day'), datetime('now', '+4 day', '+1 hour'), 5, 0, 'open');`);
}

function resolveSchemaPath() {
  const candidates = [
    path.join(__dirname, "schema.sql"),
    path.join(__dirname, "..", "db", "schema.sql"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function openDatabase() {
  // 默认库在 backend/data/，Railway 仅部署 backend 时无需上级 db/ 目录
  const dbPath = process.env.DB_PATH || path.join(__dirname, "data", "app.db");
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");

  const schemaPath = resolveSchemaPath();
  if (!schemaPath) {
    throw new Error(
      "未找到 schema.sql：请将建表脚本放在 backend/schema.sql（或与 monorepo 中 ../db/schema.sql 并存）"
    );
  }
  db.exec(fs.readFileSync(schemaPath, "utf8"));

  migrateUsersTable(db);
  seedDemoIfEmpty(db);
  return db;
}

function getDb() {
  if (!dbInstance) {
    dbInstance = openDatabase();
  }
  return dbInstance;
}

module.exports = { getDb };
