/**
 * 周主题周期（北京时间）：每周一 00:00～周日 24:00 为「一周」。
 * - 该周对应场次：周内周六、日 20:00（与 weekendSlotRules 一致）。
 * - 预约开放：该周「上一个日历日」的周日 19:00（即周一开始前的那一个周日 19:00）起，至该周周日 21:00（最后一场结束）止。
 */

const SHANGHAI = "Asia/Shanghai";

const YMD = new Intl.DateTimeFormat("en-CA", {
  timeZone: SHANGHAI,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const WD_SHORT = new Intl.DateTimeFormat("en-US", {
  timeZone: SHANGHAI,
  weekday: "short",
});

/**
 * @returns {string} YYYY-MM-DD（上海日历）
 */
function shanghaiYmdFromDate(d) {
  return YMD.format(d);
}

function parseShanghaiDateAt(ymd, hhmmss) {
  const [h, mi, se] = hhmmss.split(":").map((x) => Number(x));
  return new Date(`${ymd}T${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:${String(se || 0).padStart(2, "0")}+08:00`);
}

/** 上海日历日 ymd 所在周的周一（上海周一起算） */
function mondayOfShanghaiWeekContainingYmd(ymd) {
  let d = parseShanghaiDateAt(ymd, "12:00:00");
  if (Number.isNaN(d.getTime())) return null;
  for (let i = 0; i < 8; i++) {
    const w = WD_SHORT.format(d);
    if (w === "Mon") return shanghaiYmdFromDate(d);
    d = new Date(d.getTime() - 86400000);
  }
  return null;
}

function addCalendarDaysYmd(ymd, deltaDays) {
  const d = parseShanghaiDateAt(ymd, "12:00:00");
  if (Number.isNaN(d.getTime())) return null;
  const t = d.getTime() + deltaDays * 86400000;
  return YMD.format(new Date(t));
}

/** 该周主题开放预约的时刻：weekMonday 之前紧邻的周日 19:00（上海） */
function bookingOpensAtForWeekMonday(weekMondayYmd) {
  const sun = addCalendarDaysYmd(weekMondayYmd, -1);
  if (!sun) return null;
  return parseShanghaiDateAt(sun, "19:00:00");
}

/** 该周最后一场练习结束：weekMonday 当周周日 21:00（上海），对应周日 20:00 场次结束 */
function weekCycleEndsAtForWeekMonday(weekMondayYmd) {
  const sun = addCalendarDaysYmd(weekMondayYmd, 6);
  if (!sun) return null;
  return parseShanghaiDateAt(sun, "21:00:00");
}

/**
 * 周内周六、日 20:00 开场（各一条，若日期已过则仍返回用于历史一致性）
 * @param {string} weekMondayYmd
 * @returns {{ ymd: string, start: Date }[]}
 */
function weekendEightPmSlotsInWeek(weekMondayYmd) {
  const out = [];
  for (let i = 0; i < 7; i++) {
    const ymd = addCalendarDaysYmd(weekMondayYmd, i);
    if (!ymd) continue;
    const d = parseShanghaiDateAt(ymd, "12:00:00");
    const w = WD_SHORT.format(d);
    if (w !== "Sat" && w !== "Sun") continue;
    out.push({ ymd, start: parseShanghaiDateAt(ymd, "20:00:00") });
  }
  return out;
}

/**
 * 当前应展示/预约的「周一起算的一周」的周一 YMD（上海）。
 * 条件：已过该周的 bookingOpensAt，且尚未过该周的 cycleEndsAt。
 *
 * 周日 19:00 起会同时满足「本周」与「下周」的开放条件（本周周期要到周日 21:00 才结束）。
 * 产品要求此时应展示**下一周**主题与场次，故在多个候选周中取 **周一日期最大** 的一周。
 */
function getActiveThemeWeekMondayNow() {
  const now = Date.now();
  const todayY = shanghaiYmdFromDate(new Date());
  const baseMon = mondayOfShanghaiWeekContainingYmd(todayY);
  if (!baseMon) return null;

  let best = null;
  for (let off = -28; off <= 42; off += 7) {
    const M = addCalendarDaysYmd(baseMon, off);
    if (!M) continue;
    const open = bookingOpensAtForWeekMonday(M);
    const end = weekCycleEndsAtForWeekMonday(M);
    if (!open || !end) continue;
    if (open.getTime() > now) continue;
    if (end.getTime() <= now) continue;
    if (!best || M > best) best = M;
  }
  return best;
}

/**
 * 需要确保库中存在主题+场次的周：已过该周「周日 19:00 开放点」且该周周期尚未结束满 24h 的周（上海周一 YMD）。
 */
function getWeekMondaysToEnsure() {
  const now = Date.now();
  const todayY = shanghaiYmdFromDate(new Date());
  const baseMon = mondayOfShanghaiWeekContainingYmd(todayY);
  if (!baseMon) return [];
  const set = new Set();
  for (let off = -28; off <= 42; off += 7) {
    const M = addCalendarDaysYmd(baseMon, off);
    if (!M) continue;
    const open = bookingOpensAtForWeekMonday(M);
    const end = weekCycleEndsAtForWeekMonday(M);
    if (!open || !end) continue;
    if (open.getTime() > now) continue;
    if (end.getTime() < now - 86400000) continue;
    set.add(M);
  }
  return Array.from(set).sort();
}

module.exports = {
  SHANGHAI,
  shanghaiYmdFromDate,
  mondayOfShanghaiWeekContainingYmd,
  addCalendarDaysYmd,
  bookingOpensAtForWeekMonday,
  weekCycleEndsAtForWeekMonday,
  weekendEightPmSlotsInWeek,
  getActiveThemeWeekMondayNow,
  getWeekMondaysToEnsure,
};
