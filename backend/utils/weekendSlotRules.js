/**
 * 可预约时段规则：北京时间（Asia/Shanghai）每周六、日 20:00 开场，时长 1 小时。
 * 用于 API 过滤与种子 / 补全数据。
 */

const SHANGHAI = "Asia/Shanghai";

const SHANGHAI_YMD = new Intl.DateTimeFormat("en-CA", {
  timeZone: SHANGHAI,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const SHANGHAI_WEEKDAY_SHORT = new Intl.DateTimeFormat("en-US", {
  timeZone: SHANGHAI,
  weekday: "short",
});

const SHANGHAI_HOUR = new Intl.DateTimeFormat("en-US", {
  timeZone: SHANGHAI,
  hour: "numeric",
  hour12: false,
});

/**
 * 将 PG 返回的 naive 时间或 Date 转为用于规则判断的 Date（UTC 内部时刻）。
 * 无偏移的 `YYYY-MM-DD HH:mm:ss` 按 **上海墙上时钟** 解析，避免服务器 TZ 与 PG 存盘方式不一致导致误判。
 */
function toDateForShanghaiRule(startLike) {
  if (startLike instanceof Date) {
    return Number.isNaN(startLike.getTime()) ? null : startLike;
  }
  const s = String(startLike).trim();
  if (!s) return null;
  const naive = /^\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/;
  if (naive.test(s) && !/[zZ]$/.test(s) && !/[+-]\d{2}:?\d{2}$/.test(s)) {
    const iso = s.replace(" ", "T").slice(0, 19);
    return new Date(iso + "+08:00");
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * @param {Date|string|number} startLike 数据库或 API 中的开场时间
 * @returns {boolean}
 */
function isShanghaiSaturdayOrSundayEightPm(startLike) {
  const d = toDateForShanghaiRule(startLike);
  if (!d) return false;
  const wd = SHANGHAI_WEEKDAY_SHORT.format(d);
  if (wd !== "Sat" && wd !== "Sun") return false;
  const hour = Number(SHANGHAI_HOUR.format(d));
  return hour === 20;
}

/**
 * 按「上海日历」逐日往后扫，收集未来若干次周六/日 20:00（UTC 内部时刻）。
 * @param {number} maxSlots 最多条数
 * @param {number} [scanDays=90] 从当前时刻起最多往后看多少「自然日」步进（每步 +24h，覆盖约 scanDays 个上海日期）
 * @returns {Date[]}
 */
function generateShanghaiWeekendEightPmStarts(maxSlots, scanDays) {
  const limit = typeof scanDays === "number" ? scanDays : 90;
  const out = [];
  const seenWeekendYmd = new Set();
  const now = Date.now();
  const graceMs = 2 * 60 * 1000;

  for (let i = 0; i < limit && out.length < maxSlots; i++) {
    const probe = new Date(Date.now() + i * 24 * 60 * 60 * 1000);
    const ymd = SHANGHAI_YMD.format(probe);
    const noon = new Date(ymd + "T12:00:00+08:00");
    if (Number.isNaN(noon.getTime())) continue;
    const wd = SHANGHAI_WEEKDAY_SHORT.format(noon);
    if (wd !== "Sat" && wd !== "Sun") continue;
    if (seenWeekendYmd.has(ymd)) continue;
    seenWeekendYmd.add(ymd);

    const start = new Date(ymd + "T20:00:00+08:00");
    if (Number.isNaN(start.getTime())) continue;
    if (start.getTime() < now - graceMs) continue;
    out.push(start);
  }

  out.sort((a, b) => a.getTime() - b.getTime());
  return out;
}

/**
 * 用于写入 PG `timestamp without time zone` 的上海墙上时间字符串（与 +08 解析一致）。
 * @param {Date} d
 * @returns {{ startSql: string, endSql: string }}
 */
function toShanghaiNaiveSqlRange(d) {
  const ymd = SHANGHAI_YMD.format(d);
  return { startSql: `${ymd} 20:00:00`, endSql: `${ymd} 21:00:00` };
}

module.exports = {
  SHANGHAI,
  toDateForShanghaiRule,
  isShanghaiSaturdayOrSundayEightPm,
  generateShanghaiWeekendEightPmStarts,
  toShanghaiNaiveSqlRange,
};
