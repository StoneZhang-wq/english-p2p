/**
 * 管理员将一条 confirmed 预约从场次 A 迁到场次 B（改 bookings.timeslot_id），
 * 同步 booked_count，并删除该用户在原场次上的 pairs。
 */

async function adminMoveBooking(pool, bookingId, targetTimeslotId) {
  const bid = Number(bookingId);
  const tidTo = Number(targetTimeslotId);
  if (!bid || Number.isNaN(bid) || !tidTo || Number.isNaN(tidTo)) {
    const e = new Error("参数无效（booking_id / target_timeslot_id）");
    e.code = "INVALID";
    throw e;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: br } = await client.query(
      `SELECT b.id, b.user_id, b.timeslot_id, b.status
       FROM bookings b
       WHERE b.id = $1
       FOR UPDATE`,
      [bid]
    );
    const b = br[0];
    if (!b) {
      const e = new Error("预约不存在");
      e.code = "NOT_FOUND";
      throw e;
    }
    if (String(b.status).toLowerCase() !== "confirmed") {
      const e = new Error("仅支持迁移已确认（confirmed）预约");
      e.code = "BAD_STATE";
      throw e;
    }

    const oldTid = Number(b.timeslot_id);
    if (oldTid === tidTo) {
      const e = new Error("目标场次与当前场次相同");
      e.code = "SAME_SLOT";
      throw e;
    }

    await client.query(
      `DELETE FROM pairs
       WHERE timeslot_id = $1 AND (user_a = $2 OR user_b = $2)`,
      [oldTid, b.user_id]
    );

    const first = Math.min(oldTid, tidTo);
    const second = Math.max(oldTid, tidTo);
    await client.query(`SELECT id FROM timeslots WHERE id = $1 FOR UPDATE`, [first]);
    await client.query(`SELECT id FROM timeslots WHERE id = $1 FOR UPDATE`, [second]);

    const { rows: slots } = await client.query(
      `SELECT id, status, booked_count, max_pairs
       FROM timeslots WHERE id IN ($1, $2)`,
      [oldTid, tidTo]
    );
    if (slots.length !== 2) {
      const e = new Error("源场次或目标场次不存在");
      e.code = "SLOT_NOT_FOUND";
      throw e;
    }
    const tNew = slots.find((r) => Number(r.id) === tidTo);
    if (!tNew) {
      const e = new Error("目标场次不存在");
      e.code = "SLOT_NOT_FOUND";
      throw e;
    }

    if (String(tNew.status).toLowerCase() !== "open") {
      const e = new Error("目标场次未开放（status≠open）");
      e.code = "TARGET_CLOSED";
      throw e;
    }
    if (Number(tNew.booked_count) >= Number(tNew.max_pairs) * 2) {
      const e = new Error("目标场次名额已满");
      e.code = "TARGET_FULL";
      throw e;
    }

    const { rows: dup } = await client.query(
      `SELECT 1 FROM bookings
       WHERE user_id = $1 AND timeslot_id = $2 AND id <> $3 AND status = 'confirmed'
       LIMIT 1`,
      [b.user_id, tidTo, bid]
    );
    if (dup.length) {
      const e = new Error("该用户已在目标场次存在另一条预约");
      e.code = "DUP_TARGET";
      throw e;
    }

    const updB = await client.query(
      `UPDATE bookings SET timeslot_id = $1
       WHERE id = $2 AND timeslot_id = $3 AND status = 'confirmed'
       RETURNING id`,
      [tidTo, bid, oldTid]
    );
    if (updB.rowCount !== 1) {
      const e = new Error("迁移失败（预约可能已被修改）");
      e.code = "CONFLICT";
      throw e;
    }

    await client.query(
      `UPDATE timeslots SET booked_count = GREATEST(0, booked_count - 1) WHERE id = $1`,
      [oldTid]
    );

    const inc = await client.query(
      `UPDATE timeslots SET booked_count = booked_count + 1
       WHERE id = $1 AND status = 'open' AND booked_count < max_pairs * 2
       RETURNING booked_count`,
      [tidTo]
    );
    if (inc.rowCount !== 1) {
      const e = new Error("目标场次名额已满（写入时冲突）");
      e.code = "TARGET_FULL";
      throw e;
    }

    await client.query("COMMIT");
    return {
      bookingId: bid,
      userId: Number(b.user_id),
      fromTimeslotId: oldTid,
      toTimeslotId: tidTo,
      targetBookedCount: Number(inc.rows[0].booked_count),
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

module.exports = { adminMoveBooking };
