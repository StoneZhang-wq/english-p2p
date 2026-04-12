/**
 * 取消预约：校验归属与开场前时间窗，事务内扣减 booked_count、删除相关 pair。
 */

function parseShanghaiNaiveStart(sqlStr) {
  if (!sqlStr) return null;
  const str = String(sqlStr).trim();
  let iso = str.replace(" ", "T");
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(iso)) iso += ":00";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(iso)) return null;
  const d = new Date(iso + "+08:00");
  return Number.isNaN(d.getTime()) ? null : d;
}

async function cancelBooking(pool, userId, bookingId) {
  const bid = Number(bookingId);
  if (!bid || Number.isNaN(bid)) {
    const e = new Error("参数无效");
    e.code = "INVALID";
    throw e;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `SELECT b.id, b.status, b.timeslot_id,
        to_char(t.start_time, 'YYYY-MM-DD HH24:MI:SS') AS start_time
       FROM bookings b
       JOIN timeslots t ON t.id = b.timeslot_id
       WHERE b.id = $1 AND b.user_id = $2
       FOR UPDATE`,
      [bid, userId]
    );

    const row = rows[0];
    if (!row) {
      const e = new Error("预约不存在");
      e.code = "NOT_FOUND";
      throw e;
    }
    if (String(row.status).toLowerCase() !== "confirmed") {
      const e = new Error("该预约已无法取消");
      e.code = "BAD_STATE";
      throw e;
    }

    const startAt = parseShanghaiNaiveStart(row.start_time);
    if (startAt && Date.now() >= startAt.getTime()) {
      const e = new Error("场次已开始，无法取消");
      e.code = "STARTED";
      throw e;
    }

    // 使用 DELETE：库表上 (user_id, timeslot_id) 唯一，若仅标记 cancelled 则用户无法再约同一场次。
    const delB = await client.query(
      `DELETE FROM bookings WHERE id = $1 AND user_id = $2 AND status = 'confirmed' RETURNING timeslot_id`,
      [bid, userId]
    );
    if (delB.rowCount !== 1) {
      const e = new Error("该预约已无法取消");
      e.code = "BAD_STATE";
      throw e;
    }

    const dec = await client.query(
      `UPDATE timeslots SET booked_count = GREATEST(0, booked_count - 1) WHERE id = $1`,
      [row.timeslot_id]
    );
    if (dec.rowCount !== 1) {
      const e = new Error("更新场次失败");
      e.code = "INTERNAL";
      throw e;
    }

    await client.query(`DELETE FROM pairs WHERE timeslot_id = $1 AND (user_a = $2 OR user_b = $2)`, [
      row.timeslot_id,
      userId,
    ]);

    await client.query("COMMIT");
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

module.exports = { cancelBooking };
