const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const {
  generateShanghaiWeekendEightPmStarts,
  toShanghaiNaiveSqlRange,
} = require("./utils/weekendSlotRules");

let pool;

function resolvePostgresSchemaPath() {
  const candidates = [
    path.join(__dirname, "schema.postgres.sql"),
    path.join(__dirname, "..", "db", "schema.postgres.sql"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function buildPoolConfig() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("未设置 DATABASE_URL（PostgreSQL 连接串），例如 postgresql://user:pass@host:5432/dbname");
  }
  const isLocal =
    /localhost|127\.0\.0\.1/.test(connectionString) &&
    !/sslmode=require/i.test(connectionString);
  const ssl = isLocal ? false : { rejectUnauthorized: false };
  return { connectionString, ssl, max: Number(process.env.PG_POOL_MAX) || 20 };
}

/** 按语句执行，避免部分驱动对多语句单包的限制 */
async function runSqlFile(clientOrPool, filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const noComments = raw
    .split(/\r?\n/)
    .filter((line) => !/^\s*--/.test(line))
    .join("\n");
  const chunks = noComments
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const sql of chunks) {
    await clientOrPool.query(sql + ";");
  }
}

async function migrateUsersPasswordColumn(p) {
  await p.query(`
    DO $do$
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users')
         AND NOT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'password_hash'
         ) THEN
        ALTER TABLE users ADD COLUMN password_hash TEXT;
      END IF;
    END
    $do$;
  `);
}

async function seedThemesIfEmpty(p) {
  const { rows: tc } = await p.query("SELECT COUNT(*)::int AS c FROM themes");
  if (tc[0].c > 0) return;
  await p.query(`INSERT INTO themes (name, description, difficulty_level, is_active) VALUES
      ('职场面试', '模拟英文面试，讨论职业规划', 'intermediate', 1),
      ('雅思口语 Part 2', '随机抽取题库进行 2 分钟独白练习', 'intermediate', 1),
      ('日常闲聊', '轻松的话题，分享生活趣事', 'beginner', 1)`);
}

/** 每个活跃主题补全未来若干次「上海周六/日 20:00」场次（与 API 过滤一致；按 start_time 去重） */
async function ensureWeekendTimeslots(p) {
  const { rows: themeRows } = await p.query("SELECT id FROM themes WHERE is_active = 1 ORDER BY id");
  if (themeRows.length === 0) return;

  const starts = generateShanghaiWeekendEightPmStarts(16, 90);
  if (starts.length === 0) return;

  for (const row of themeRows) {
    const themeId = Number(row.id);
    for (const st of starts) {
      const { startSql, endSql } = toShanghaiNaiveSqlRange(st);
      const { rows: dup } = await p.query(
        `SELECT 1 FROM timeslots WHERE theme_id = $1 AND start_time = $2::timestamp LIMIT 1`,
        [themeId, startSql]
      );
      if (dup.length > 0) continue;
      await p.query(
        `INSERT INTO timeslots (theme_id, start_time, end_time, max_pairs, booked_count, status) VALUES ($1, $2::timestamp, $3::timestamp, 5, 0, 'open')`,
        [themeId, startSql, endSql]
      );
    }
  }
}

async function seedDemoIfEmpty(p) {
  await seedThemesIfEmpty(p);
  await ensureWeekendTimeslots(p);
}

async function initDb() {
  const schemaPath = resolvePostgresSchemaPath();
  if (!schemaPath) {
    throw new Error("未找到 schema.postgres.sql（backend/ 或 db/）");
  }

  pool = new Pool(buildPoolConfig());

  const client = await pool.connect();
  try {
    await runSqlFile(client, schemaPath);
    await migrateUsersPasswordColumn(client);
    await seedDemoIfEmpty(client);
  } finally {
    client.release();
  }
}

function getPool() {
  if (!pool) {
    throw new Error("数据库尚未初始化，请先 await initDb()");
  }
  return pool;
}

module.exports = { initDb, getPool };
