/**
 * 可预约时段规则：北京时间（Asia/Shanghai）每周六、日 20:00 开场，时长 1 小时。
 * 用于 API 过滤与空库种子数据生成。
 */

const SHANGHAI = "Asia/Shanghai";

/**
 * @param {Date|string|number} startLike 数据库或 API 中的开场时间
 * @returns {boolean}
 */
function isShanghaiSaturdayOrSundayEightPm(startLike) {
  const d = startLike instanceof Date ? startLike : new Date(startLike);
  if (Number.isNaN(d.getTime())) return false;
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: SHANGHAI,
    weekday: "short",
  }).format(d);
  if (wd !== "Sat" && wd !== "Sun") return false;
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: SHANGHAI,
      hour: "numeric",
      hour12: false,
    }).format(d)
  );
  return hour === 20;
}

/**
 * 生成未来若干次「上海周六/日 20:00」开场时间（Date 对象，UTC 内部表示）。
 * @param {number} maxSlots 最多条数（各主题共用同一批日历点时可重复插入）
 * @param {number} [scanDays=56]
 * @returns {Date[]}
 */
function generateShanghaiWeekendEightPmStarts(maxSlots, scanDays) {
  const limit = typeof scanDays === "number" ? scanDays : 56;
  const out = [];
  const seenYmd = new Set();
  const now = Date.now();

  for (let i = 0; i < limit && out.length < maxSlots; i++) {
    const probe = new Date(now + i * 24 * 60 * 60 * 1000);
    const wd = new Intl.DateTimeFormat("en-US", {
      timeZone: SHANGHAI,
      weekday: "short",
    }).format(probe);
    if (wd !== "Sat" && wd !== "Sun") continue;

    const ymd = new Intl.DateTimeFormat("en-CA", {
      timeZone: SHANGHAI,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(probe);
    if (seenYmd.has(ymd)) continue;
    seenYmd.add(ymd);

    const [y, mo, da] = ymd.split("-").map((x) => parseInt(x, 10));
    const start = new Date(
      `${y}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}T20:00:00+08:00`
    );
    if (Number.isNaN(start.getTime())) continue;
    if (start.getTime() < now - 30 * 60 * 1000) continue;
    out.push(start);
  }
  out.sort((a, b) => a.getTime() - b.getTime());
  return out;
}

module.exports = {
  SHANGHAI,
  isShanghaiSaturdayOrSundayEightPm,
  generateShanghaiWeekendEightPmStarts,
};
