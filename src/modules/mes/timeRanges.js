import { DAY_MS, MES_BASE_LOOKBACK_DAYS, MES_THROUGHPUT_RANGE_OPTIONS, MES_THROUGHPUT_SHIFT_RANGE_KEYS } from './constants';

export function getMesShiftWindow(nowValue = Date.now()) {
  const now = new Date(nowValue);
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();
  const hour = now.getHours();
  const buildPoint = (dayOffset, hours) => new Date(year, month, day + dayOffset, hours, 0, 0, 0);

  let shiftStart = null;
  let shiftEnd = null;
  let shiftLabel = "";

  if (hour >= 6 && hour < 14) {
    shiftStart = buildPoint(0, 6);
    shiftEnd = buildPoint(0, 14);
    shiftLabel = "06:00 - 14:00";
  } else if (hour >= 14 && hour < 22) {
    shiftStart = buildPoint(0, 14);
    shiftEnd = buildPoint(0, 22);
    shiftLabel = "14:00 - 22:00";
  } else if (hour >= 22) {
    shiftStart = buildPoint(0, 14);
    shiftEnd = buildPoint(0, 22);
    shiftLabel = "14:00 - 22:00";
  } else {
    shiftStart = buildPoint(-1, 14);
    shiftEnd = buildPoint(-1, 22);
    shiftLabel = "14:00 - 22:00";
  }

  const nowMs = now.getTime();
  const shiftStartMs = shiftStart.getTime();
  const shiftEndMs = shiftEnd.getTime();
  const rangeEndMs = Math.max(shiftStartMs, Math.min(nowMs, shiftEndMs));
  return {
    shiftLabel,
    shiftStartAt: shiftStart.toISOString(),
    shiftEndAt: shiftEnd.toISOString(),
    shiftStartMs,
    shiftEndMs,
    nowMs,
    rangeEndMs,
    isActive: nowMs >= shiftStartMs && nowMs < shiftEndMs
  };
}

export function getMesOeeRangeWindow(rangeKey, nowValue = Date.now()) {
  const now = new Date(nowValue);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (rangeKey === "yesterday") {
    const start = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);
    const end = startOfToday;
    return {
      label: "Včera",
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      startMs: start.getTime(),
      endMs: end.getTime(),
      rangeEndMs: end.getTime(),
      isActive: false
    };
  }
  if (rangeKey === "last_5_days") {
    const start = new Date(startOfToday.getTime() - 4 * 24 * 60 * 60 * 1000);
    const end = now;
    return {
      label: "Posledných 5 dní",
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      startMs: start.getTime(),
      endMs: end.getTime(),
      rangeEndMs: end.getTime(),
      isActive: true
    };
  }
  const shiftWindow = getMesShiftWindow(nowValue);
  return {
    label: `Zmena ${shiftWindow.shiftLabel}`,
    startAt: shiftWindow.shiftStartAt,
    endAt: shiftWindow.shiftEndAt,
    startMs: shiftWindow.shiftStartMs,
    endMs: shiftWindow.shiftEndMs,
    rangeEndMs: shiftWindow.rangeEndMs,
    isActive: shiftWindow.isActive
  };
}

export function getMesDailyShiftWindow(shiftKey, nowValue = Date.now(), dayOffset = 0, rangeNowValue = nowValue) {
  const baseNow = new Date(nowValue);
  const now = new Date(baseNow);
  if (Number.isFinite(dayOffset) && dayOffset !== 0) {
    now.setDate(now.getDate() + Number(dayOffset));
  }
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();
  const startHour = shiftKey === "shift_14_22" ? 14 : 6;
  const endHour = shiftKey === "shift_14_22" ? 22 : 14;
  const start = new Date(year, month, day, startHour, 0, 0, 0);
  const end = new Date(year, month, day, endHour, 0, 0, 0);
  const startMs = start.getTime();
  const endMs = end.getTime();
  const nowMs = new Date(rangeNowValue).getTime();
  const rangeEndMs = Math.max(startMs, Math.min(nowMs, endMs));
  return {
    key: shiftKey === "shift_14_22" ? "shift_14_22" : "shift_06_14",
    label: shiftKey === "shift_14_22" ? "14:00 - 22:00" : "06:00 - 14:00",
    dayLabel: start.toLocaleDateString("sk-SK", { day: "2-digit", month: "2-digit", year: "numeric" }),
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    startMs,
    endMs,
    rangeEndMs,
    isActive: nowMs >= startMs && nowMs < endMs
  };
}

export function padDatePart(value) {
  return String(value).padStart(2, "0");
}

export function makeMesLocalHourKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}T${padDatePart(date.getHours())}`;
}

export function makeMesLocalMinuteKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return `${makeMesLocalHourKey(date)}:${padDatePart(date.getMinutes())}`;
}

export function makeMesLocalDayKey(value) {
  return formatMesDateInputValue(value);
}

export function getMesCurrentShiftWindow(nowTs = Date.now()) {
  const now = new Date(nowTs);
  const start = new Date(now);
  start.setMinutes(0, 0, 0);

  const hour = now.getHours();
  if (hour >= 22) {
    start.setHours(22, 0, 0, 0);
  } else if (hour >= 14) {
    start.setHours(14, 0, 0, 0);
  } else if (hour >= 6) {
    start.setHours(6, 0, 0, 0);
  } else {
    start.setDate(start.getDate() - 1);
    start.setHours(22, 0, 0, 0);
  }

  const end = new Date(start);
  end.setHours(end.getHours() + 8);
  return { startAt: start, endAt: now < end ? now : end };
}

export function getMesThroughputRangeWindow(rangeKey, customStartDate, customEndDate, shiftDateValue, nowTs = Date.now()) {
  const now = new Date(nowTs);
  const selectedRange = MES_THROUGHPUT_RANGE_OPTIONS.some((option) => option.key === rangeKey) ? rangeKey : "last_8_hours";

  if (selectedRange === "last_30_minutes") {
    const startAt = new Date(now.getTime() - 30 * 60 * 1000);
    startAt.setSeconds(0, 0);
    return { startAt, endAt: now, bucket: "minute", label: "posledných 30 min" };
  }

  if (selectedRange === "current_shift") {
    const window = getMesCurrentShiftWindow(nowTs);
    return { ...window, bucket: "hour", label: "aktuálna zmena" };
  }

  if (MES_THROUGHPUT_SHIFT_RANGE_KEYS.has(selectedRange)) {
    const shiftDate = shiftDateValue ? new Date(`${shiftDateValue}T00:00:00`) : now;
    const baseDate = Number.isNaN(shiftDate.getTime()) ? now : shiftDate;
    const shiftWindow = getMesDailyShiftWindow(selectedRange, baseDate.getTime(), 0, nowTs);
    return {
      startAt: new Date(shiftWindow.startMs),
      endAt: new Date(shiftWindow.rangeEndMs),
      bucket: "hour",
      label: `${selectedRange === "shift_14_22" ? "poobedná" : "ranná"} smena ${shiftWindow.dayLabel}`
    };
  }

  if (selectedRange === "today") {
    const startAt = new Date(now);
    startAt.setHours(0, 0, 0, 0);
    return { startAt, endAt: now, bucket: "hour", label: "dnes" };
  }

  if (selectedRange === "yesterday") {
    const startAt = new Date(now);
    startAt.setDate(startAt.getDate() - 1);
    startAt.setHours(0, 0, 0, 0);
    const endAt = new Date(startAt);
    endAt.setHours(23, 59, 59, 999);
    return { startAt, endAt, bucket: "hour", label: "včera" };
  }

  if (selectedRange === "last_7_days") {
    const startAt = new Date(now);
    startAt.setDate(startAt.getDate() - 6);
    startAt.setHours(0, 0, 0, 0);
    return { startAt, endAt: now, bucket: "day", label: "posledných 7 dní" };
  }

  if (selectedRange === "custom") {
    const parsedStart = customStartDate ? new Date(`${customStartDate}T00:00:00`) : null;
    const parsedEnd = customEndDate ? new Date(`${customEndDate}T23:59:59.999`) : null;
    const startAt = parsedStart && !Number.isNaN(parsedStart.getTime()) ? parsedStart : new Date(now.getTime() - 7 * 60 * 60 * 1000);
    let endAt = parsedEnd && !Number.isNaN(parsedEnd.getTime()) ? parsedEnd : now;
    if (endAt < startAt) {
      endAt = new Date(startAt);
      endAt.setHours(23, 59, 59, 999);
    }
    const durationMs = endAt.getTime() - startAt.getTime();
    return {
      startAt,
      endAt,
      bucket: durationMs > 48 * 60 * 60 * 1000 ? "day" : "hour",
      label: `${startAt.toLocaleDateString("sk-SK")} - ${endAt.toLocaleDateString("sk-SK")}`
    };
  }

  const startAt = new Date(now);
  startAt.setMinutes(0, 0, 0);
  startAt.setHours(startAt.getHours() - 7);
  return { startAt, endAt: now, bucket: "hour", label: "posledných 8 hodín" };
}

export function getMesInclusiveLookbackDays(startValue, nowTs = Date.now()) {
  const startMs = new Date(startValue || 0).getTime();
  if (!Number.isFinite(startMs) || startMs <= 0) {
    return MES_BASE_LOOKBACK_DAYS;
  }
  return Math.max(1, Math.ceil((nowTs - startMs) / DAY_MS) + 1);
}

export function buildMesThroughputSeries(rangeWindow) {
  const startAt = new Date(rangeWindow?.startAt || Date.now());
  const endAt = new Date(rangeWindow?.endAt || Date.now());
  const bucket = ["minute", "day"].includes(rangeWindow?.bucket) ? rangeWindow.bucket : "hour";
  const series = [];
  const cursor = new Date(startAt);
  if (bucket === "day") {
    cursor.setHours(0, 0, 0, 0);
  } else if (bucket === "minute") {
    cursor.setSeconds(0, 0);
  } else {
    cursor.setMinutes(0, 0, 0);
  }

  while (cursor <= endAt && series.length < 96) {
    series.push({
      key: bucket === "day" ? makeMesLocalDayKey(cursor) : bucket === "minute" ? makeMesLocalMinuteKey(cursor) : makeMesLocalHourKey(cursor),
      label:
        bucket === "day"
          ? cursor.toLocaleDateString("sk-SK", { day: "2-digit", month: "2-digit" })
          : cursor.toLocaleTimeString("sk-SK", { hour: "2-digit", minute: "2-digit" }),
      good: 0,
      scrap: 0,
      total: 0
    });
    if (bucket === "day") {
      cursor.setDate(cursor.getDate() + 1);
    } else if (bucket === "minute") {
      cursor.setMinutes(cursor.getMinutes() + 1);
    } else {
      cursor.setHours(cursor.getHours() + 1);
    }
  }

  return series;
}
