const { CHANNEL_PATTERN } = require("../services/agoraToken");

/** 同场次未写入 pairs 前的等待大厅频道（所有该场预约用户共用） */
function waitingChannelForTimeslot(timeslotId) {
  const tid = Number(timeslotId);
  const base = `engw${Number.isFinite(tid) ? tid : 0}`;
  const s = base.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  return CHANNEL_PATTERN.test(s) ? s : `w${String(Math.abs(tid)).slice(0, 60)}`;
}

/** 写入 pairs 后的 1v1 频道 */
function pairChannelForInsert(timeslotId) {
  const tid = Number(timeslotId);
  const base = `engp${tid}_${Date.now()}`;
  return base.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

module.exports = { waitingChannelForTimeslot, pairChannelForInsert };
