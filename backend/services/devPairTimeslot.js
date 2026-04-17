/**
 * 开发调试用：为同一场次下「当前用户 + 另一名已预约用户」写入 pairs（同场任意两人）。
 * 会先删除该 timeslot_id 下全部 pairs，再插入新行（避免重复调试堆积）。
 */

const { findCompatiblePairIncludingCaller } = require("../utils/levelCompatibility");
const { CHANNEL_PATTERN } = require("./agoraToken");

function makeDevChannelName(timeslotId) {
  const base = `dev_eng_${timeslotId}_${Date.now()}`;
  const safe = base.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  if (!CHANNEL_PATTERN.test(safe)) {
    const fallback = `dev_${String(timeslotId)}_${Date.now()}`.slice(0, 64);
    return CHANNEL_PATTERN.test(fallback) ? fallback : `d${Date.now()}`.slice(0, 64);
  }
  return safe;
}

/**
 * @param {import("pg").Pool} pool
 * @param {number} callerUserId
 * @param {number} timeslotId
 */
async function devPairTimeslotForCaller(pool, callerUserId, timeslotId) {
  const tid = Number(timeslotId);
  if (!tid || Number.isNaN(tid)) {
    const e = new Error("参数无效");
    e.code = "INVALID";
    throw e;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const slotR = await client.query("SELECT id, status FROM timeslots WHERE id = $1 FOR UPDATE", [tid]);
    if (!slotR.rows[0]) {
      const e = new Error("场次不存在");
      e.code = "NOT_FOUND";
      throw e;
    }

    const bookR = await client.query(
      `SELECT id, user_id, level FROM bookings WHERE timeslot_id = $1 AND status = 'confirmed' ORDER BY id ASC`,
      [tid]
    );
    const bookings = bookR.rows;
    if (bookings.length < 2) {
      const e = new Error("该场次需要至少两名已确认预约的用户");
      e.code = "NEED_TWO";
      throw e;
    }

    const pairUsers = findCompatiblePairIncludingCaller(bookings, callerUserId);
    if (!pairUsers) {
      const e = new Error("你在该场次无预约，或没有等级差≤1的另一名预约者可配对");
      e.code = "NO_MATCH";
      throw e;
    }

    const ua = Math.min(pairUsers.userA.user_id, pairUsers.userB.user_id);
    const ub = Math.max(pairUsers.userA.user_id, pairUsers.userB.user_id);
    const channelName = makeDevChannelName(tid);

    await client.query(`DELETE FROM pairs WHERE timeslot_id = $1`, [tid]);

    const ins = await client.query(
      `INSERT INTO pairs (timeslot_id, user_a, user_b, channel_name, status)
       VALUES ($1, $2, $3, $4, 'pending')
       RETURNING id, channel_name`,
      [tid, ua, ub, channelName]
    );

    await client.query("COMMIT");

    const row = ins.rows[0];
    return {
      pairId: row.id,
      timeslotId: tid,
      channelName: row.channel_name,
      userA: ua,
      userB: ub,
    };
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

module.exports = { devPairTimeslotForCaller };
