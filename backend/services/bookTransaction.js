/**
 * 预约：事务 + SELECT … FOR UPDATE 锁定场次行，防止超卖（PostgreSQL）。
 */

async function bookTimeslot(pool, userId, timeslotId, level) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "SELECT id, booked_count, max_pairs, status FROM timeslots WHERE id = $1 FOR UPDATE",
      [timeslotId]
    );
    const slot = rows[0];

    if (!slot) {
      const e = new Error("场次不存在");
      e.code = "NOT_FOUND";
      throw e;
    }
    if (slot.status !== "open") {
      const e = new Error("场次不可预约");
      e.code = "CLOSED";
      throw e;
    }
    if (Number(slot.booked_count) >= Number(slot.max_pairs) * 2) {
      const e = new Error("名额已满");
      e.code = "FULL";
      throw e;
    }

    try {
      await client.query(
        `INSERT INTO bookings (user_id, timeslot_id, level, status) VALUES ($1, $2, $3, 'confirmed')`,
        [userId, timeslotId, level]
      );
    } catch (insErr) {
      if (insErr && insErr.code === "23505") {
        const e = new Error("您已预约该场次");
        e.code = "DUP";
        throw e;
      }
      throw insErr;
    }

    const upd = await client.query(
      `UPDATE timeslots SET booked_count = booked_count + 1
       WHERE id = $1 AND status = 'open' AND booked_count < max_pairs * 2
       RETURNING id`,
      [timeslotId]
    );

    if (upd.rowCount !== 1) {
      const e = new Error("名额已满");
      e.code = "FULL";
      throw e;
    }

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

module.exports = { bookTimeslot };
