const toNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

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
