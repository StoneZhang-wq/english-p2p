/**
 * 预约写入：BEGIN IMMEDIATE 占写锁，与 ARCHITECTURE / 产品文档中的并发控制一致。
 * 名额：max_pairs 表示「配对数」，单场最多 max_pairs * 2 人（每人占 1 个 booked_count）。
 */

function bookTimeslot(db, userId, timeslotId, level) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const slot = db
      .prepare("SELECT id, booked_count, max_pairs, status FROM timeslots WHERE id = ?")
      .get(timeslotId);

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
    if (slot.booked_count >= slot.max_pairs * 2) {
      const e = new Error("名额已满");
      e.code = "FULL";
      throw e;
    }

    try {
      db.prepare(
        "INSERT INTO bookings (user_id, timeslot_id, level, status) VALUES (?, ?, ?, 'confirmed')"
      ).run(userId, timeslotId, level);
    } catch (insErr) {
      if (insErr && (String(insErr.message).includes("UNIQUE") || String(insErr.code).includes("CONSTRAINT"))) {
        const e = new Error("您已预约该场次");
        e.code = "DUP";
        throw e;
      }
      throw insErr;
    }

    const upd = db
      .prepare(
        "UPDATE timeslots SET booked_count = booked_count + 1 WHERE id = ? AND status = 'open' AND booked_count < max_pairs * 2"
      )
      .run(timeslotId);

    if (upd.changes !== 1) {
      const e = new Error("名额已满");
      e.code = "FULL";
      throw e;
    }

    db.exec("COMMIT");
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch (_) {
      /* ignore */
    }
    throw e;
  }
}

module.exports = { bookTimeslot };
