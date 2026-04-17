/**
 * 对「未结束且 status=open」的场次，为尚未出现在 pairs 中的已确认预约用户做贪心配对（同场任意两人即可，按预约 id 顺序两两一组）。
 */

const { findFirstCompatiblePairInBookings } = require("../utils/levelCompatibility");
const { pairChannelForInsert } = require("../utils/agoraChannelNames");

function parseShanghaiNaive(sqlStr) {
  if (!sqlStr) return null;
  const str = String(sqlStr).trim();
  let iso = str.replace(" ", "T");
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(iso)) iso += ":00";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(iso)) return null;
  const d = new Date(iso + "+08:00");
  return Number.isNaN(d.getTime()) ? null : d;
}

async function greedyPairUnmatchedForTimeslot(client, timeslotId) {
  for (;;) {
    const { rows: bookings } = await client.query(
      `SELECT b.id, b.user_id, b.level FROM bookings b
       WHERE b.timeslot_id = $1 AND b.status = 'confirmed'
       AND NOT EXISTS (
         SELECT 1 FROM pairs p
         WHERE p.timeslot_id = $1
         AND (p.user_a = b.user_id OR p.user_b = b.user_id)
       )
       ORDER BY b.id ASC`,
      [timeslotId]
    );
    if (bookings.length < 2) return;

    const picked = findFirstCompatiblePairInBookings(bookings);
    if (!picked) return;

    const [u1, u2] = picked;
    const ua = Math.min(u1.user_id, u2.user_id);
    const ub = Math.max(u1.user_id, u2.user_id);
    const channelName = pairChannelForInsert(timeslotId);

    await client.query(
      `INSERT INTO pairs (timeslot_id, user_a, user_b, channel_name, status)
       VALUES ($1, $2, $3, $4, 'pending')`,
      [timeslotId, ua, ub, channelName]
    );
  }
}

/**
 * 扫描所有 open 场次，对「当前时刻 < end_time」（上海 naive）的场次执行一轮贪心配对（含开场前已约满两两互配）。
 */
async function runAutoPairingScan(pool) {
  const { rows } = await pool.query(
    `SELECT id,
      to_char(start_time, 'YYYY-MM-DD HH24:MI:SS') AS start_time,
      to_char(end_time, 'YYYY-MM-DD HH24:MI:SS') AS end_time
     FROM timeslots
     WHERE status = 'open'`
  );

  const now = Date.now();
  const eligible = rows.filter((r) => {
    const te = parseShanghaiNaive(r.end_time);
    if (!te) return false;
    return now < te.getTime();
  });

  for (const r of eligible) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const lock = await client.query("SELECT id FROM timeslots WHERE id = $1 FOR UPDATE", [r.id]);
      if (!lock.rowCount) {
        await client.query("ROLLBACK");
        continue;
      }
      await greedyPairUnmatchedForTimeslot(client, r.id);
      await client.query("COMMIT");
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch (_) {
        /* ignore */
      }
      console.error("[auto-pair] timeslot", r.id, e && e.message ? e.message : e);
    } finally {
      client.release();
    }
  }
}

module.exports = { runAutoPairingScan, parseShanghaiNaive };
