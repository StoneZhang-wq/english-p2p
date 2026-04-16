const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const {
  getWeekMondaysToEnsure,
  weekendEightPmSlotsInWeek,
  weekCycleEndsAtForWeekMonday,
} = require("./utils/weekThemeCycle");
const { ensureSandboxLab } = require("./services/sandboxLab");

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

async function migrateThemesSandboxFlag(p) {
  await p.query(`ALTER TABLE themes ADD COLUMN IF NOT EXISTS is_sandbox BOOLEAN NOT NULL DEFAULT FALSE`);
}

async function migrateThemesLlmColumns(p) {
  await p.query(`ALTER TABLE themes ADD COLUMN IF NOT EXISTS room_tasks_json JSONB`);
  await p.query(`ALTER TABLE themes ADD COLUMN IF NOT EXISTS llm_generated_at TIMESTAMPTZ`);
  await p.query(`ALTER TABLE themes ADD COLUMN IF NOT EXISTS llm_prompt_version TEXT`);
}

async function migrateThemeGenerationsTable(p) {
  await p.query(`
    CREATE TABLE IF NOT EXISTS theme_generations (
      id SERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by_email VARCHAR(120),
      direction TEXT NOT NULL,
      pack_json JSONB NOT NULL,
      pack_version TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'preview',
      applied_theme_id INTEGER REFERENCES themes (id),
      applied_at TIMESTAMPTZ
    );
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_theme_generations_created_at ON theme_generations (created_at DESC)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_theme_generations_status ON theme_generations (status)`);
}

async function migrateWeeklyThemesColumns(p) {
  await p.query(`
    ALTER TABLE themes
      ADD COLUMN IF NOT EXISTS shanghai_week_monday DATE,
      ADD COLUMN IF NOT EXISTS theme_slot SMALLINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS slug VARCHAR(64),
      ADD COLUMN IF NOT EXISTS scene_text TEXT,
      ADD COLUMN IF NOT EXISTS roles_json TEXT,
      ADD COLUMN IF NOT EXISTS cover_url TEXT,
      ADD COLUMN IF NOT EXISTS preview_markdown TEXT
  `);
  await p.query(`DROP INDEX IF EXISTS idx_themes_week_slot`);
  await p.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_themes_week_slot
    ON themes (shanghai_week_monday, theme_slot)
    WHERE shanghai_week_monday IS NOT NULL AND is_active = 1
  `);
}

async function archiveExpiredThemeWeeks(p) {
  const { rows } = await p.query(
    `SELECT id, shanghai_week_monday::text AS week_m FROM themes
     WHERE is_active = 1 AND shanghai_week_monday IS NOT NULL AND COALESCE(is_sandbox, FALSE) = FALSE`
  );
  const now = Date.now();
  for (const row of rows) {
    if (!row.week_m) continue;
    const end = weekCycleEndsAtForWeekMonday(row.week_m.slice(0, 10));
    if (end && end.getTime() < now) {
      await p.query(`UPDATE themes SET is_active = 0 WHERE id = $1`, [row.id]);
      await p.query(`UPDATE timeslots SET status = 'closed' WHERE theme_id = $1`, [row.id]);
    }
  }
}

async function ensureTimeslotsForThemeWeek(p, themeId, weekMon) {
  const slots = weekendEightPmSlotsInWeek(weekMon);
  for (const { ymd } of slots) {
    const startSql = `${ymd} 20:00:00`;
    const endSql = `${ymd} 21:00:00`;
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

async function ensureWeeklyThemeCycle(p) {
  const weeks = getWeekMondaysToEnsure();
  for (const weekMon of weeks) {
    const { rows: cntRows } = await p.query(
      `SELECT COUNT(*)::int AS c FROM themes WHERE shanghai_week_monday = $1::date AND is_active = 1`,
      [weekMon]
    );
    const n = cntRows[0].c;

    if (n === 0) {
      for (let slot = 0; slot < 3; slot++) {
        const slug = `w${String(weekMon).replace(/-/g, "")}_${slot}`;
        const { rows: ins } = await p.query(
          `INSERT INTO themes (name, description, difficulty_level, is_active, shanghai_week_monday, theme_slot, slug, scene_text, roles_json, cover_url, preview_markdown)
           VALUES ($1, $2, $3, 1, $4::date, $5, $6, $7, $8, $9, $10) RETURNING id`,
          [
            `待生成主题 ${slot + 1}`,
            "待管理员生成内容（请在 admin.html 中为该槽位输入方向并生成）。",
            "intermediate",
            weekMon,
            slot,
            slug,
            "【待生成】请在管理员后台为该主题生成场景背景。",
            JSON.stringify([
              { label: "ROLE 1", name: "角色A", desc: "【待生成】" },
              { label: "ROLE 2", name: "角色B", desc: "【待生成】" },
            ]),
            "https://images.unsplash.com/photo-1521737604893-d14cc237f11d?w=800&q=80",
            "# 学习目标\n- （待生成）\n\n# 核心词汇\n- （待生成）\n",
          ]
        );
        await ensureTimeslotsForThemeWeek(p, ins[0].id, weekMon);
      }
      continue;
    }

    if (n < 3) {
      const { rows: slotsHave } = await p.query(
        `SELECT theme_slot FROM themes WHERE shanghai_week_monday = $1::date AND is_active = 1`,
        [weekMon]
      );
      const have = new Set(slotsHave.map((r) => Number(r.theme_slot)));
      for (let slot = 0; slot < 3; slot++) {
        if (have.has(slot)) continue;
        const slug = `w${String(weekMon).replace(/-/g, "")}_${slot}`;
        const { rows: ins } = await p.query(
          `INSERT INTO themes (name, description, difficulty_level, is_active, shanghai_week_monday, theme_slot, slug, scene_text, roles_json, cover_url, preview_markdown)
           VALUES ($1, $2, $3, 1, $4::date, $5, $6, $7, $8, $9, $10) RETURNING id`,
          [
            `待生成主题 ${slot + 1}`,
            "待管理员生成内容（请在 admin.html 中为该槽位输入方向并生成）。",
            "intermediate",
            weekMon,
            slot,
            slug,
            "【待生成】请在管理员后台为该主题生成场景背景。",
            JSON.stringify([
              { label: "ROLE 1", name: "角色A", desc: "【待生成】" },
              { label: "ROLE 2", name: "角色B", desc: "【待生成】" },
            ]),
            "https://images.unsplash.com/photo-1521737604893-d14cc237f11d?w=800&q=80",
            "# 学习目标\n- （待生成）\n\n# 核心词汇\n- （待生成）\n",
          ]
        );
        await ensureTimeslotsForThemeWeek(p, ins[0].id, weekMon);
      }
    }

    const { rows: themes } = await p.query(
      `SELECT id FROM themes WHERE shanghai_week_monday = $1::date AND is_active = 1 ORDER BY theme_slot ASC`,
      [weekMon]
    );
    for (const t of themes) {
      await ensureTimeslotsForThemeWeek(p, t.id, weekMon);
    }
  }
}

async function runWeeklyThemeMaintenance() {
  if (!pool) return;
  const client = await pool.connect();
  try {
    await archiveExpiredThemeWeeks(client);
    await ensureWeeklyThemeCycle(client);
  } finally {
    client.release();
  }
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
    await migrateWeeklyThemesColumns(client);
    await migrateThemesSandboxFlag(client);
    await migrateThemesLlmColumns(client);
    await migrateThemeGenerationsTable(client);
    await client.query(
      `UPDATE themes SET is_active = 0 WHERE shanghai_week_monday IS NULL AND COALESCE(is_sandbox, FALSE) = FALSE`
    );
    await archiveExpiredThemeWeeks(client);
    await ensureWeeklyThemeCycle(client);
    await ensureSandboxLab(client);
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

module.exports = { initDb, getPool, runWeeklyThemeMaintenance };
