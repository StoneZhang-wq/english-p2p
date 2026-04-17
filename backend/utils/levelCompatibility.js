/**
 * 等级工具（预约仍记录 level；配对策略已改为「同一场次内不看出身等级」）。
 * 保留 levelsCompatible 等函数供统计或未来策略复用。
 */

const LEVEL_ORDER = {
  beginner: 0,
  intermediate: 1,
  advanced: 2,
};

function levelDistance(levelA, levelB) {
  const a = LEVEL_ORDER[String(levelA || "").toLowerCase()];
  const b = LEVEL_ORDER[String(levelB || "").toLowerCase()];
  if (a === undefined || b === undefined) return Infinity;
  return Math.abs(a - b);
}

function levelsCompatible(levelA, levelB) {
  return levelDistance(levelA, levelB) <= 1;
}

/**
 * 同一场次：与当前用户配对的第一名「其他」已确认预约用户（按列表顺序）。
 * @param {{ user_id: number, level: string }[]} bookings
 * @param {number} callerUserId
 * @returns {{ userA: typeof bookings[0], userB: typeof bookings[0] } | null}
 */
function findCompatiblePairIncludingCaller(bookings, callerUserId) {
  const me = bookings.find((b) => Number(b.user_id) === Number(callerUserId));
  if (!me) return null;
  const other = bookings.find((b) => Number(b.user_id) !== Number(callerUserId));
  if (!other) return null;
  return { userA: me, userB: other };
}

/**
 * 同一场次贪心：按 `ORDER BY b.id` 后的列表，取尚未入 pair 的前两名互配。
 * @param {{ user_id: number, level: string }[]} bookings
 * @returns {[typeof bookings[0], typeof bookings[0]] | null}
 */
function findFirstCompatiblePairInBookings(bookings) {
  if (!Array.isArray(bookings) || bookings.length < 2) return null;
  return [bookings[0], bookings[1]];
}

module.exports = {
  LEVEL_ORDER,
  levelDistance,
  levelsCompatible,
  findCompatiblePairIncludingCaller,
  findFirstCompatiblePairInBookings,
};
