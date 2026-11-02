const toNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

export const MINUTES_PER_DAY = 24 * 60;
export const SHIFT_MINUTES = 8 * 60;
export const WORKDAY_START_MINUTE = 6 * 60 + 30;

const positiveModulo = (value, divisor) => ((value % divisor) + divisor) % divisor;

export function getDefaultStartOffset(shift) {
  const shiftIndex = Math.min(2, Math.max(0, Number(shift) - 1 || 0));
  return shiftIndex * SHIFT_MINUTES;
}

export function getOrderStartOffset(order) {
  const fallback = getDefaultStartOffset(order?.shift);
  return positiveModulo(toNumber(order?.startOffsetMinutes, fallback), MINUTES_PER_DAY);
}

export function getShiftFromStartOffset(startOffsetMinutes) {
  return Math.min(3, Math.floor(positiveModulo(startOffsetMinutes, MINUTES_PER_DAY) / SHIFT_MINUTES) + 1);
}

export function clockTimeToStartOffset(value) {
  const [hours, minutes] = String(value || "").split(":").map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  const clockMinutes = hours * 60 + minutes;
  return positiveModulo(clockMinutes - WORKDAY_START_MINUTE, MINUTES_PER_DAY);
}

export function startOffsetToClockTime(startOffsetMinutes) {
  const clockMinutes = positiveModulo(toNumber(startOffsetMinutes) + WORKDAY_START_MINUTE, MINUTES_PER_DAY);
  const hours = Math.floor(clockMinutes / 60);
  const minutes = clockMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function calculateOrderMetrics(order, machine) {
  const quantity = Math.max(0, toNumber(order.quantity));
  const completedQuantity = Math.min(quantity, Math.max(0, toNumber(order.completedQuantity)));
  const remainingQuantity = Math.max(0, quantity - completedQuantity);
  const cycleTimeSec = Math.max(0, toNumber(order.cycleTimeSec));
  const setupMinutes = Math.max(0, toNumber(order.setupMinutes));
  const efficiencyPercent = Math.min(100, Math.max(1, toNumber(machine?.targetEfficiency, 100)));
  const efficiency = efficiencyPercent / 100;
  const productionHours = quantity * cycleTimeSec / 3600 / efficiency;
  const totalHours = setupMinutes / 60 + productionHours;
  const remainingHours = (completedQuantity === 0 ? setupMinutes / 60 : 0)
    + remainingQuantity * cycleTimeSec / 3600 / efficiency;

  return {
    quantity,
    completedQuantity,
    remainingQuantity,
    cycleTimeSec,
    setupMinutes,
    efficiencyPercent,
    productionHours,
    totalHours,
    remainingHours
  };
}

export function getOrderScheduleInterval(order, machine) {
  if (!order?.machineId || !Number.isInteger(order.day)) return null;
  const start = order.day * MINUTES_PER_DAY + getOrderStartOffset(order);
  const durationMinutes = Math.max(1, Math.round(calculateOrderMetrics(order, machine).totalHours * 60));
  return { start, end: start + durationMinutes, durationMinutes };
}

export function findScheduleConflict(candidate, orders, machines) {
  const machine = machines.find((item) => item.id === candidate?.machineId);
  const candidateInterval = getOrderScheduleInterval(candidate, machine);
  if (!candidateInterval) return null;

  return orders.find((order) => {
    if (order.id === candidate.id || order.machineId !== candidate.machineId || !Number.isInteger(order.day)) return false;
    const otherMachine = machines.find((item) => item.id === order.machineId);
    const otherInterval = getOrderScheduleInterval(order, otherMachine);
    return otherInterval && candidateInterval.start < otherInterval.end && candidateInterval.end > otherInterval.start;
  }) || null;
}

export function findFirstAvailableSchedule(candidate, orders, machines) {
  const machine = machines.find((item) => item.id === candidate?.machineId);
  const candidateInterval = getOrderScheduleInterval(candidate, machine);
  if (!candidateInterval) return candidate;
  const intervals = orders
    .filter((order) => order.id !== candidate.id && order.machineId === candidate.machineId && Number.isInteger(order.day))
    .map((order) => getOrderScheduleInterval(order, machine))
    .filter(Boolean)
    .sort((left, right) => left.start - right.start);
  let start = candidateInterval.start;

  intervals.forEach((interval) => {
    if (start < interval.end && start + candidateInterval.durationMinutes > interval.start) start = interval.end;
  });

  const day = Math.floor(start / MINUTES_PER_DAY);
  const startOffsetMinutes = positiveModulo(start, MINUTES_PER_DAY);
  return { ...candidate, day, startOffsetMinutes, shift: getShiftFromStartOffset(startOffsetMinutes) };
}

export function hydrateOrderTiming(order, machines) {
  const machine = machines.find((item) => item.id === order.machineId);
  const efficiency = Math.min(100, Math.max(1, toNumber(machine?.targetEfficiency, 100))) / 100;
  const quantity = Math.max(1, toNumber(order.quantity, 1));
  const setupMinutes = Math.max(0, toNumber(order.setupMinutes, 30));
  const fallbackProductionHours = Math.max(0.05, toNumber(order.duration, 1) - setupMinutes / 60);
  const cycleTimeSec = order.cycleTimeSec ?? Number((fallbackProductionHours * 3600 * efficiency / quantity).toFixed(2));
  const completedQuantity = order.completedQuantity
    ?? Math.round(quantity * Math.min(100, Math.max(0, toNumber(order.progress))) / 100);

  return { ...order, setupMinutes, cycleTimeSec, completedQuantity };
}

export function formatHours(value) {
  return new Intl.NumberFormat("sk-SK", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(toNumber(value));
}
