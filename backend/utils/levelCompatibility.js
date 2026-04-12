/** 与产品第 9 节一致：口语等级差距不超过一级可配对 */

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
 * @param {{ user_id: number, level: string }[]} bookings 同一场次已确认预约
 * @param {number} callerUserId
 * @returns {{ userA: typeof bookings[0], userB: typeof bookings[0] } | null}
 */
function findCompatiblePairIncludingCaller(bookings, callerUserId) {
  const me = bookings.find((b) => Number(b.user_id) === Number(callerUserId));
  if (!me) return null;
  for (const other of bookings) {
    if (Number(other.user_id) === Number(callerUserId)) continue;
    if (levelsCompatible(me.level, other.level)) {
      return { userA: me, userB: other };
    }
  }
  return null;
}

module.exports = { LEVEL_ORDER, levelDistance, levelsCompatible, findCompatiblePairIncludingCaller };
