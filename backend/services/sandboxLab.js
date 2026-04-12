/**
 * 沙箱实验室：专用主题 `sandbox-lab` + 单场次，刷新为「上海 now+3min ~ now+63min」。
 * 仅与 ENABLE_SANDBOX_LAB / 非生产 API 联用；刷新会清空该场次 bookings 与 pairs。
 */

const SANDBOX_SLUG = "sandbox-lab";

async function queryShanghaiWindow(client) {
  const st = await client.query(
    `SELECT to_char((timezone('Asia/Shanghai', now()) + interval '3 minutes')::timestamp, 'YYYY-MM-DD HH24:MI:SS') AS s`
  );
  const en = await client.query(
    `SELECT to_char((timezone('Asia/Shanghai', now()) + interval '63 minutes')::timestamp, 'YYYY-MM-DD HH24:MI:SS') AS e`
  );
  return { startSql: st.rows[0].s, endSql: en.rows[0].e };
}

/**
 * 启动时：确保沙箱主题存在且至少有一条 open 场次（若无则插入一条带当前窗口的场次）。
 * @param {import("pg").PoolClient} client
 */
async function ensureSandboxLab(client) {
  const { rows: th } = await client.query(`SELECT id FROM themes WHERE slug = $1 LIMIT 1`, [SANDBOX_SLUG]);
  let themeId;
  if (!th[0]) {
    const ins = await client.query(
      `INSERT INTO themes (name, description, difficulty_level, is_active, shanghai_week_monday, theme_slot, slug, scene_text, roles_json, cover_url, preview_markdown, is_sandbox)
       VALUES ($1, $2, 'intermediate', 1, NULL, 0, $3, $4, $5, $6, $7, TRUE) RETURNING id`,
      [
        "沙箱实验室",
        "联调专用：不受周末场次过滤与开场前 60 分钟停约限制；在沙箱页刷新后约 3 分钟开场。",
        SANDBOX_SLUG,
        "用于随时验收预约、配对与进房。",
        "[]",
        "",
        "# 沙箱预习\n\n本主题为测试入口，可验证预习下载与房间流程。",
      ]
    );
    themeId = ins.rows[0].id;
  } else {
    themeId = th[0].id;
    await client.query(`UPDATE themes SET is_active = 1, is_sandbox = TRUE WHERE id = $1`, [themeId]);
  }

  const { rows: ts } = await client.query(
    `SELECT id FROM timeslots WHERE theme_id = $1 AND status = 'open' ORDER BY id ASC LIMIT 1`,
    [themeId]
  );
  if (ts[0]) return;

  const { startSql, endSql } = await queryShanghaiWindow(client);
  await client.query(
    `INSERT INTO timeslots (theme_id, start_time, end_time, max_pairs, booked_count, status)
     VALUES ($1, $2::timestamp, $3::timestamp, 5, 0, 'open')`,
    [themeId, startSql, endSql]
  );
}

/**
 * @param {import("pg").Pool} pool
 * @returns {Promise<{ themeId: number, timeslotId: number, startTime: string, endTime: string } | null>}
 */
async function getSandboxLabSnapshot(pool) {
  const { rows: th } = await pool.query(`SELECT id FROM themes WHERE slug = $1 AND is_active = 1 LIMIT 1`, [
    SANDBOX_SLUG,
  ]);
  if (!th[0]) return null;
  const themeId = th[0].id;
  const { rows: ts } = await pool.query(
    `SELECT id,
       to_char(start_time, 'YYYY-MM-DD HH24:MI:SS') AS start_time,
       to_char(end_time, 'YYYY-MM-DD HH24:MI:SS') AS end_time
     FROM timeslots WHERE theme_id = $1 AND status = 'open' ORDER BY id ASC LIMIT 1`,
    [themeId]
  );
  if (!ts[0]) return { themeId, timeslotId: null, startTime: null, endTime: null };
  return {
    themeId,
    timeslotId: ts[0].id,
    startTime: ts[0].start_time,
    endTime: ts[0].end_time,
  };
}

/**
 * 将沙箱场次重置为「约 3 分钟后开始」，并删除该场次全部 pairs / bookings。
 * @param {import("pg").Pool} pool
 */
async function refreshSandboxTimeslot(pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: th } = await client.query(`SELECT id FROM themes WHERE slug = $1 FOR UPDATE`, [SANDBOX_SLUG]);
    if (!th[0]) {
      const err = new Error("沙箱主题不存在，请确认 initDb 已执行");
      err.code = "NO_SANDBOX";
      throw err;
    }
    const themeId = th[0].id;
    await client.query(`UPDATE themes SET is_active = 1, is_sandbox = TRUE WHERE id = $1`, [themeId]);

    let { rows: ts } = await client.query(
      `SELECT id FROM timeslots WHERE theme_id = $1 AND status = 'open' ORDER BY id ASC LIMIT 1 FOR UPDATE`,
      [themeId]
    );

    const { startSql, endSql } = await queryShanghaiWindow(client);
    let timeslotId;

    if (!ts[0]) {
      const ins = await client.query(
        `INSERT INTO timeslots (theme_id, start_time, end_time, max_pairs, booked_count, status)
         VALUES ($1, $2::timestamp, $3::timestamp, 5, 0, 'open') RETURNING id`,
        [themeId, startSql, endSql]
      );
      timeslotId = ins.rows[0].id;
    } else {
      timeslotId = ts[0].id;
      await client.query(`DELETE FROM pairs WHERE timeslot_id = $1`, [timeslotId]);
      await client.query(`DELETE FROM bookings WHERE timeslot_id = $1`, [timeslotId]);
      await client.query(
        `UPDATE timeslots SET start_time = $1::timestamp, end_time = $2::timestamp, booked_count = 0, status = 'open' WHERE id = $3`,
        [startSql, endSql, timeslotId]
      );
    }

    await client.query("COMMIT");
    return { themeId, timeslotId, startTime: startSql, endTime: endSql };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {
  SANDBOX_SLUG,
  ensureSandboxLab,
  getSandboxLabSnapshot,
  refreshSandboxTimeslot,
};
