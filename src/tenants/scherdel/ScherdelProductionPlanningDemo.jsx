import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, ArrowLeft, ArrowRight, Ban, CalendarDays, CheckCircle2, Clock3,
  Boxes, ClipboardList, Factory, Gauge, GitBranch, GripVertical, Layers3, PackagePlus, Pin, Plus, Search, Settings2, Sparkles, Trash2, X
} from "lucide-react";
import { motion } from "motion/react";
import ScherdelMaterialRegistry from "./ScherdelMaterialRegistry";
import ScherdelNewProductionOrderModal from "./ScherdelNewProductionOrderModal";
import ScherdelResourceConfiguration from "./ScherdelResourceConfiguration";
import {
  MINUTES_PER_DAY, SHIFT_MINUTES, WORKDAY_START_MINUTE, calculateOrderMetrics, clockTimeToStartOffset, findFirstAvailableSchedule, findScheduleConflict,
  formatHours, getDefaultStartOffset, getOrderScheduleInterval, getOrderStartOffset, getShiftFromStartOffset,
  hydrateOrderTiming, startOffsetToClockTime
} from "./productionPlanningCalculations";
import { FRAME_MODELS, SCHERDEL_PRODUCT_CATALOG } from "./scherdelProductCatalog";
import "./scherdelProductionPlanningDemo.css";

const DAY_COUNT = 5;
const SHIFTS = [
  { value: 1, label: "Ranná", time: "06:30 – 14:30" },
  { value: 2, label: "Poobedná", time: "14:30 – 22:30" },
  { value: 3, label: "Nočná", time: "22:30 – 06:30" }
];
const INITIAL_WORKPLACES = [
  { id: "forming", name: "Ohýbanie drôtu", area: "Hala A", supervisor: "", active: true },
  { id: "welding", name: "Zváranie rámov", area: "Hala A", supervisor: "", active: true },
  { id: "quality", name: "Kontrola kvality", area: "Hala B", supervisor: "", active: true },
  { id: "shipping", name: "Výstup a expedícia", area: "Hala B", supervisor: "", active: true }
];
const BENDING_MACHINES = Array.from({ length: 5 }, (_, index) => ({
  id: `bend-${String(index + 1).padStart(2, "0")}`,
  code: `OH-${String(index + 1).padStart(2, "0")}`,
  name: `Ohýbačka drôtu ${String(index + 1).padStart(2, "0")}`,
  workplaceId: "forming", shiftCount: 3, hoursPerDay: 24, targetEfficiency: 82 + (index % 7),
  productIds: SCHERDEL_PRODUCT_CATALOG.filter((product) => product.operation === "Ohýbanie drôtu" && (product.sequence - 1) % 5 === index).map((product) => product.id), active: true
}));
const WELDING_MACHINES = Array.from({ length: 2 }, (_, index) => ({
  id: `weld-${String(index + 1).padStart(2, "0")}`,
  code: `ZV-${String(index + 1).padStart(2, "0")}`,
  name: `Zváračka rámov ${String(index + 1).padStart(2, "0")}`,
  workplaceId: "welding", shiftCount: 3, hoursPerDay: 24, targetEfficiency: 86 + index,
  productIds: FRAME_MODELS.filter((_, modelIndex) => modelIndex % 2 === index).map((model) => `${model.id}-welded`), active: true
}));
const INITIAL_MACHINES = [
  ...BENDING_MACHINES,
  ...WELDING_MACHINES,
  { id: "qc-01", code: "QC-01", name: "Kontrola kvality 01", workplaceId: "quality", shiftCount: 2, hoursPerDay: 16, targetEfficiency: 93, productIds: SCHERDEL_PRODUCT_CATALOG.filter((product) => product.productStage === "quality").map((product) => product.id), active: true },
  { id: "out-01", code: "OUT-01", name: "Výstup / expedícia 01", workplaceId: "shipping", shiftCount: 2, hoursPerDay: 16, targetEfficiency: 94, productIds: SCHERDEL_PRODUCT_CATALOG.filter((product) => product.productStage === "output").map((product) => product.id), active: true }
];
const PRIORITY_LABELS = { high: "Vysoká", normal: "Normálna", low: "Nízka" };
const STATUS_LABELS = { confirmed: "Potvrdené", draft: "Návrh", risk: "Riziko", running: "Vo výrobe" };

const DEMO_CUSTOMER_LOTS = [
  { code: "A", orderNumber: "AO-DEMO-4821", quantity: 420, dueDay: 2, priority: "high" },
  { code: "B", orderNumber: "AO-DEMO-4876", quantity: 780, dueDay: 4, priority: "normal" }
];

const INITIAL_ORDERS = FRAME_MODELS.flatMap((model) => DEMO_CUSTOMER_LOTS.flatMap((lot) => {
  const inputProducts = SCHERDEL_PRODUCT_CATALOG.filter((product) => product.frameModelId === model.id && product.operation === "Ohýbanie drôtu");
  const lotId = `${model.id}-${lot.code}`;
  const inputOrders = inputProducts.map((product, index) => ({
    id: `demo-${lotId}-input-${String(index + 1).padStart(2, "0")}`,
    number: `VP-${model.code}-${lot.code}-P${String(index + 1).padStart(2, "0")}`,
    customerOrderNumber: lot.orderNumber,
    productId: product.id,
    itemCode: product.itemCode,
    itemName: product.itemName,
    quantity: lot.quantity,
    completedQuantity: 0,
    cycleTimeSec: product.cycleTimeSec,
    setupMinutes: product.setupMinutes,
    machineId: null,
    day: null,
    shift: 1,
    priority: lot.priority,
    status: "draft",
    dueDay: Math.max(0, lot.dueDay - (index < 10 ? 2 : 1)),
    predecessorOrderIds: [],
    progress: 0
  }));
  const weldingProduct = SCHERDEL_PRODUCT_CATALOG.find((product) => product.id === `${model.id}-welded`);
  const qualityProduct = SCHERDEL_PRODUCT_CATALOG.find((product) => product.id === `${model.id}-qc`);
  const outputProduct = SCHERDEL_PRODUCT_CATALOG.find((product) => product.id === `${model.id}-output`);
  const stageOrder = (product, stage, stageDueDay, predecessorOrderIds) => ({
    id: `demo-${lotId}-${stage}`,
    number: `VP-${model.code}-${lot.code}-${stage.toUpperCase()}`,
    customerOrderNumber: lot.orderNumber,
    productId: product.id,
    itemCode: product.itemCode,
    itemName: product.itemName,
    quantity: lot.quantity,
    completedQuantity: 0,
    cycleTimeSec: product.cycleTimeSec,
    setupMinutes: product.setupMinutes,
    machineId: null,
    day: null,
    shift: 1,
    priority: lot.priority,
    status: "draft",
    dueDay: stageDueDay,
    predecessorOrderIds,
    progress: 0
  });
  const weldingOrder = stageOrder(weldingProduct, "welding", lot.dueDay, inputOrders.map((order) => order.id));
  const qualityOrder = stageOrder(qualityProduct, "qc", Math.min(4, lot.dueDay + 1), [weldingOrder.id]);
  const outputOrder = stageOrder(outputProduct, "output", 4, [qualityOrder.id]);
  return [...inputOrders, weldingOrder, qualityOrder, outputOrder];
}));

const dateFormatter = new Intl.DateTimeFormat("sk-SK", { day: "2-digit", month: "2-digit" });
const longDateFormatter = new Intl.DateTimeFormat("sk-SK", { day: "numeric", month: "long", year: "numeric" });
const weekdayFormatter = new Intl.DateTimeFormat("sk-SK", { weekday: "short" });
const numberFormatter = new Intl.NumberFormat("sk-SK");

function startOfWorkWeek(date) {
  const result = new Date(date);
  result.setHours(12, 0, 0, 0);
  const weekday = result.getDay() || 7;
  result.setDate(result.getDate() - weekday + 1);
  return result;
}

function addDays(date, count) {
  const result = new Date(date);
  result.setDate(result.getDate() + count);
  return result;
}

function toDateInputValue(date) {
  const local = new Date(date);
  local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
  return local.toISOString().slice(0, 10);
}

function getPlanDayFromDate(value, week) {
  const date = new Date(`${value}T12:00:00`);
  const monday = new Date(week[0]);
  monday.setHours(12, 0, 0, 0);
  return Number.isFinite(date.getTime()) ? Math.round((date.getTime() - monday.getTime()) / 86400000) : 4;
}

function getOrderDueMinute(order, week) {
  const dueDay = order.dueDate ? getPlanDayFromDate(order.dueDate, week) : Number(order.dueDay ?? 4);
  return (dueDay + 1) * MINUTES_PER_DAY;
}

function buildWeek(offset) {
  const monday = addDays(startOfWorkWeek(new Date()), offset * 7);
  return Array.from({ length: DAY_COUNT }, (_, index) => addDays(monday, index));
}

function sameCalendarDay(left, right) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}

function getCurrentPlanMinute(date) {
  const dayAtNoon = new Date(date);
  dayAtNoon.setHours(12, 0, 0, 0);
  const monday = startOfWorkWeek(date);
  const calendarDay = Math.round((dayAtNoon.getTime() - monday.getTime()) / 86400000);
  const clockMinutes = date.getHours() * 60 + date.getMinutes();
  if (clockMinutes >= WORKDAY_START_MINUTE) return calendarDay * MINUTES_PER_DAY + clockMinutes - WORKDAY_START_MINUTE;
  return (calendarDay - 1) * MINUTES_PER_DAY + clockMinutes + MINUTES_PER_DAY - WORKDAY_START_MINUTE;
}

function formatPlanMoment(absoluteMinute, week) {
  const planningDay = Math.floor(absoluteMinute / MINUTES_PER_DAY);
  const startOffsetMinutes = ((absoluteMinute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const clockTotal = startOffsetMinutes + WORKDAY_START_MINUTE;
  const calendarDay = planningDay + (clockTotal >= MINUTES_PER_DAY ? 1 : 0);
  const label = weekdayFormatter.format(addDays(week[0], calendarDay)).replace(".", "");
  return `${label} ${startOffsetToClockTime(startOffsetMinutes)}`;
}

function getFlowScheduleInfo(order, machines, week) {
  const machine = machines.find((item) => item.id === order.machineId) || null;
  const machineLabel = machine ? `${machine.code} · ${machine.name}` : order.machineId ? `Stroj ${order.machineId}` : "Stroj nepriradený";
  if (!order.machineId) return { machineLabel, timeLabel: "Čaká v backloge na naplánovanie" };
  if (!Number.isInteger(order.day)) return { machineLabel, timeLabel: "Deň a čas ešte nie sú určené" };
  const interval = getOrderScheduleInterval(order, machine);
  return {
    machineLabel,
    timeLabel: interval ? `${formatPlanMoment(interval.start, week)} – ${formatPlanMoment(interval.end, week)}` : `${weekdayFormatter.format(addDays(week[0], order.day))} · čas sa nedá vypočítať`
  };
}

function formatOrderEndHint(order) {
  const endOffset = getOrderStartOffset(order) + Math.round((Number(order.duration) || 0) * 60);
  const daysLater = Math.floor(endOffset / MINUTES_PER_DAY);
  return `Koniec približne ${startOffsetToClockTime(endOffset)}${daysLater ? ` (+${daysLater} d.)` : ""}`;
}

function getShift(shift) {
  return SHIFTS.find((row) => row.value === Number(shift)) || SHIFTS[0];
}

function buildOrderShiftSegments(order) {
  const segments = [];
  let remainingMinutes = Math.max(0, Math.round((Number(order.duration) || 0) * 60));
  let cursor = (Number.isInteger(order.day) ? order.day : 0) * MINUTES_PER_DAY + getOrderStartOffset(order);

  while (remainingMinutes > 0 && segments.length < 90) {
    const day = Math.floor(cursor / MINUTES_PER_DAY);
    const startOffsetMinutes = ((cursor % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    const shiftIndex = Math.min(SHIFTS.length - 1, Math.floor(startOffsetMinutes / SHIFT_MINUTES));
    const shiftEnd = day * MINUTES_PER_DAY + (shiftIndex + 1) * SHIFT_MINUTES;
    const segmentMinutes = Math.min(remainingMinutes, shiftEnd - cursor);
    segments.push({
      day,
      shift: SHIFTS[shiftIndex].value,
      hours: Number((segmentMinutes / 60).toFixed(1)),
      startMinute: cursor,
      timeRange: `${startOffsetToClockTime(startOffsetMinutes)}–${startOffsetToClockTime(startOffsetMinutes + segmentMinutes)}`,
      part: segments.length + 1,
      isContinuation: segments.length > 0
    });
    remainingMinutes -= segmentMinutes;
    cursor += segmentMinutes;
  }

  return segments;
}

function getLoadTone(value) {
  if (value >= 90) return "critical";
  if (value >= 72) return "warning";
  return "healthy";
}

function getShiftLoadTone(value) {
  if (value > 100) return "overloaded";
  if (value >= 90) return "full";
  if (value >= 70) return "busy";
  return "available";
}

function canMachineProduceOrder(machine, order) {
  return Boolean(order?.productId && machine?.productIds?.includes(order.productId));
}

function FlowDependencyNode({ order, direction, machines, week, onOpen }) {
  const schedule = getFlowScheduleInfo(order, machines, week);
  return <button type="button" className="flow-dependency-node" onClick={() => onOpen(order.id)}>
    <small>{direction}</small><b>{order.itemCode} · {order.number}</b><span>{order.itemName}</span><span className="flow-node-plan"><b>{schedule.machineLabel}</b><small>{schedule.timeLabel}</small></span>
  </button>;
}

function FlowDependencyPanel({ order, machines, week, pinned, onTogglePin, onOpen, onMouseEnter, onMouseLeave }) {
  const inputs = order.predecessorOrders || [];
  const outputs = order.successorOrders || [];
  const schedule = getFlowScheduleInfo(order, machines, week);
  return <aside className="calendar-flow-panel" aria-label={`Materiálový tok zákazky ${order.number}`} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
    <header><span><GitBranch size={15} /><b>Materiálový tok</b></span><button type="button" onClick={() => onTogglePin(order.id)} title={pinned ? "Odopnúť tok" : "Ponechať tok otvorený"} aria-pressed={pinned}><Pin size={14} />{pinned ? "Pripnuté" : "Pripnúť"}</button></header>
    <div className="flow-dependency-links">
      {inputs.length ? <section><b>Vstupuje materiál z ({inputs.length})</b><div>{inputs.map((inputOrder) => <FlowDependencyNode key={inputOrder.id} order={inputOrder} direction="Vstupný polotovar" machines={machines} week={week} onOpen={onOpen} />)}</div></section> : null}
      {inputs.length ? <div className="flow-dependency-arrow"><ArrowRight size={15} /><span>vstupuje do tejto zákazky</span></div> : null}
      <section className="flow-dependency-current"><small>Vybraná zákazka</small><button type="button" onClick={() => onOpen(order.id)}><b>{order.itemCode} · {order.number}</b><span>{order.itemName} · {numberFormatter.format(order.quantity)} ks</span><span className="flow-node-plan"><b>{schedule.machineLabel}</b><small>{schedule.timeLabel}</small></span></button></section>
      {outputs.length ? <div className="flow-dependency-arrow"><ArrowRight size={15} /><span>výstup pokračuje do</span></div> : null}
      {outputs.length ? <section><b>Táto zákazka nadväzuje do ({outputs.length})</b><div>{outputs.map((outputOrder) => <FlowDependencyNode key={outputOrder.id} order={outputOrder} direction="Nasledujúca operácia" machines={machines} week={week} onOpen={onOpen} />)}</div></section> : null}
    </div>
  </aside>;
}

function PlanningOrderCard({ order, segment = null, compact = false, isDragging = false, justMoved = false, flowPinned = false, onOpen, onMoveSelect, onDragStart, onDragEnd, onFlowEnter, onFlowLeave, onToggleFlow }) {
  const shift = getShift(segment?.shift ?? order.shift);
  const displayedHours = segment?.hours ?? order.duration;
  const startOffset = getOrderStartOffset(order);
  const timeRange = segment?.timeRange ?? `${startOffsetToClockTime(startOffset)}–${startOffsetToClockTime(startOffset + Math.round(order.duration * 60))}`;
  return (
    <div className="planning-order-hover-area" onMouseEnter={!compact && (order.predecessorOrders?.length || order.successorOrders?.length) ? () => onFlowEnter(order.id) : undefined} onMouseLeave={!compact && (order.predecessorOrders?.length || order.successorOrders?.length) ? onFlowLeave : undefined} onFocusCapture={!compact && (order.predecessorOrders?.length || order.successorOrders?.length) ? () => onFlowEnter(order.id) : undefined} onBlurCapture={!compact && (order.predecessorOrders?.length || order.successorOrders?.length) ? onFlowLeave : undefined}>
    <div
      draggable
      className={`scherdel-plan-order ${order.status} priority-${order.priority} ${compact ? "compact" : ""} ${isDragging ? "is-dragging" : ""} ${justMoved ? "just-moved" : ""}`}
      onDragStart={(event) => onDragStart(event, order.id)}
      onDragEnd={onDragEnd}
    >
      <button type="button" draggable className="drag-handle" aria-pressed={isDragging} title={isDragging ? "Zrušiť presun" : "Vybrať na presun"} onClick={(event) => { event.stopPropagation(); onMoveSelect(order.id); }} onDragStart={(event) => { event.stopPropagation(); onDragStart(event, order.id); }} onDragEnd={onDragEnd}><GripVertical size={15} aria-hidden="true" /></button>
      {!compact && (order.predecessorOrders?.length || order.successorOrders?.length) ? <button type="button" className="order-flow-toggle" aria-label={flowPinned ? `Odopnúť materiálový tok zákazky ${order.number}` : `Zobraziť a pripnúť materiálový tok zákazky ${order.number}`} aria-pressed={flowPinned} title={flowPinned ? "Odopnúť materiálový tok" : "Zobraziť materiálový tok"} onClick={(event) => { event.stopPropagation(); onToggleFlow(order.id); }}><GitBranch size={12} /></button> : null}
      <button type="button" className="order-open" onClick={(event) => { event.stopPropagation(); onOpen(order.id); }} aria-label={`${order.number}, ${order.itemName}`}>
        <span className="order-copy"><strong>{order.number}{segment?.isContinuation ? <em>Pokračovanie</em> : null}</strong><small>{order.itemCode} · {order.itemName}</small>{compact && order.customerOrderNumber ? <small className="order-customer-ref">Odberateľ: {order.customerOrderNumber}</small> : null}{order.chainSummary ? <span className="order-chain-hint"><GitBranch size={10} />{order.chainSummary}</span> : null}{compact && order.dueDate ? <small className="order-backlog-due">Termín: {weekdayFormatter.format(new Date(`${order.dueDate}T12:00:00`))} {dateFormatter.format(new Date(`${order.dueDate}T12:00:00`))}</small> : null}</span>
        {!compact ? <span className="order-meta"><b>{shift.label} · {timeRange}</b><small>{displayedHours} h{segment && order.duration > 8 ? ` z ${order.duration} h` : ""} · termín {order.dueDate ? dateFormatter.format(new Date(`${order.dueDate}T12:00:00`)) : "–"}</small></span> : null}
      </button>
      {order.status === "risk" ? <AlertTriangle className="risk-icon" size={15} aria-label="Riziková zákazka" /> : null}
      {order.status === "running" ? <span className="running-progress" style={{ "--progress": `${order.progress}%` }}>{order.progress}%</span> : null}
    </div>
    </div>
  );
}

export default function ScherdelProductionPlanningDemo() {
  const [activeModule, setActiveModule] = useState(() => {
    const module = new URLSearchParams(window.location.search).get("module");
    if (module === "resources") return "resources";
    if (module === "machine-orders") return "machineOrders";
    return "plan";
  });
  const [machines, setMachines] = useState(INITIAL_MACHINES);
  const [workplaces, setWorkplaces] = useState(INITIAL_WORKPLACES);
  const [products, setProducts] = useState(() => SCHERDEL_PRODUCT_CATALOG.map((product) => ({ ...product, feedsIntoProductIds: [...(product.feedsIntoProductIds || [])] })));
  const [orders, setOrders] = useState(() => {
    const initialWeek = buildWeek(0);
    return INITIAL_ORDERS.map((order) => hydrateOrderTiming({
      ...order,
      dueDate: toDateInputValue(initialWeek[order.dueDay] || initialWeek[4]),
      predecessorOrderIds: [...(order.predecessorOrderIds || [])],
      startOffsetMinutes: order.startOffsetMinutes ?? getDefaultStartOffset(order.shift),
      productId: SCHERDEL_PRODUCT_CATALOG.find((product) => product.itemCode === order.itemCode)?.id || null
    }, INITIAL_MACHINES));
  });
  const [demoOrdersCleared, setDemoOrdersCleared] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [calendarView, setCalendarView] = useState("day");
  const [planningNow, setPlanningNow] = useState(() => new Date());
  const [scheduleNotice, setScheduleNotice] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [hoveredFlowOrderId, setHoveredFlowOrderId] = useState(null);
  const [pinnedFlowOrderId, setPinnedFlowOrderId] = useState(null);
  const [draggedOrderId, setDraggedOrderId] = useState(null);
  const [recentlyMovedOrderId, setRecentlyMovedOrderId] = useState(null);
  const [machineOrdersInitialMachineId, setMachineOrdersInitialMachineId] = useState(null);
  const [machineOrdersInitialDay, setMachineOrdersInitialDay] = useState(null);
  const [machineOrdersInitialShift, setMachineOrdersInitialShift] = useState(null);
  const [isNewOrderOpen, setIsNewOrderOpen] = useState(false);
  const moveAnimationTimerRef = useRef(null);
  const flowHoverTimerRef = useRef(null);
  const week = useMemo(() => buildWeek(weekOffset), [weekOffset]);
  const activeMachines = useMemo(() => machines.filter((machine) => machine.active), [machines]);
  const workplaceById = useMemo(() => new Map(workplaces.map((workplace) => [workplace.id, workplace])), [workplaces]);
  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const calculatedOrders = useMemo(() => orders.map((order) => {
    const machine = machines.find((item) => item.id === order.machineId);
    const metrics = calculateOrderMetrics(order, machine);
    const product = productById.get(order.productId);
    const inputProducts = products.filter((item) => item.feedsIntoProductIds?.includes(order.productId));
    const downstreamProducts = (product?.feedsIntoProductIds || []).map((id) => productById.get(id)).filter(Boolean);
    const interval = getOrderScheduleInterval(order, machine);
    const missesDueDate = Boolean(interval && interval.end > getOrderDueMinute(order, week));
    const chainSummary = inputProducts.length
      ? `${inputProducts.length > 3 ? `${inputProducts.length} polotovarov` : inputProducts.map((item) => item.itemCode).join(" + ")} → ${order.itemCode}`
      : downstreamProducts.length
        ? `${order.itemCode} → ${downstreamProducts.map((item) => item.itemCode).join(", ")}`
        : "";
    return {
      ...order,
      status: missesDueDate && order.status !== "running" ? "risk" : order.status,
      duration: Number(metrics.totalHours.toFixed(1)),
      metrics,
      inputProducts,
      downstreamProducts,
      predecessorOrders: (order.predecessorOrderIds || []).map((id) => orders.find((candidate) => candidate.id === id)).filter(Boolean),
      successorOrders: orders.filter((candidate) => (candidate.predecessorOrderIds || []).includes(order.id)),
      chainSummary,
      missesDueDate
    };
  }), [machines, orders, productById, products, week]);

  const visibleOrders = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("sk-SK");
    return calculatedOrders.filter((order) => {
      const matchesSearch = !query || `${order.number} ${order.itemCode} ${order.itemName}`.toLocaleLowerCase("sk-SK").includes(query);
      const matchesFilter = filter === "all" || (filter === "risk" ? order.status === "risk" : order.priority === filter);
      return matchesSearch && matchesFilter;
    });
  }, [calculatedOrders, filter, search]);

  const selectedOrder = calculatedOrders.find((order) => order.id === selectedOrderId) || null;
  const activeFlowOrder = calculatedOrders.find((order) => order.id === hoveredFlowOrderId)
    || calculatedOrders.find((order) => order.id === pinnedFlowOrderId)
    || null;
  const draggedOrder = calculatedOrders.find((order) => order.id === draggedOrderId) || null;
  const selectedOrderMachines = selectedOrder?.productId
    ? activeMachines.filter((machine) => machine.id === selectedOrder.machineId || machine.productIds?.includes(selectedOrder.productId))
    : activeMachines;
  const backlog = visibleOrders.filter((order) => !order.machineId);
  const backlogGroups = useMemo(() => {
    const groups = new Map();
    backlog.forEach((order) => {
      const date = order.dueDate || "bez-terminu";
      if (!groups.has(date)) groups.set(date, []);
      groups.get(date).push(order);
    });
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [backlog]);
  const scheduled = visibleOrders.filter((order) => order.machineId && Number.isInteger(order.day));
  const scheduledAll = calculatedOrders.filter((order) => order.machineId && Number.isInteger(order.day));
  const riskCount = calculatedOrders.filter((order) => order.status === "risk").length;
  const plannedHours = scheduledAll.reduce((sum, order) => sum + Number(order.duration || 0), 0);
  const totalCapacity = activeMachines.reduce((sum, machine) => sum + Number(machine.hoursPerDay || 0) * DAY_COUNT, 0);
  const overallLoad = totalCapacity ? Math.round(plannedHours / totalCapacity * 100) : 0;

  const machineLoads = useMemo(() => new Map(activeMachines.map((machine) => {
    const hours = scheduledAll.filter((order) => order.machineId === machine.id).reduce((sum, order) => sum + Number(order.duration || 0), 0);
    const capacity = Number(machine.hoursPerDay || 0) * DAY_COUNT;
    return [machine.id, { hours, percent: capacity ? Math.round(hours / capacity * 100) : 0 }];
  })), [activeMachines, scheduledAll]);

  const machineQueues = useMemo(() => {
    const referenceMinute = weekOffset === 0 ? getCurrentPlanMinute(planningNow) : Number.NEGATIVE_INFINITY;
    return new Map(activeMachines.map((machine) => {
      const queue = calculatedOrders
        .filter((order) => order.machineId === machine.id && Number.isInteger(order.day))
        .map((order) => ({ order, interval: getOrderScheduleInterval(order, machine) }))
        .filter((item) => item.interval)
        .sort((left, right) => left.interval.start - right.interval.start);
      const current = Number.isFinite(referenceMinute)
        ? queue.find((item) => item.interval.start <= referenceMinute && item.interval.end > referenceMinute) || null
        : null;
      const nextThreshold = current?.interval.end ?? referenceMinute;
      const next = queue.find((item) => item.order.id !== current?.order.id && item.interval.start >= nextThreshold) || null;
      return [machine.id, { current, next }];
    }));
  }, [activeMachines, calculatedOrders, planningNow, weekOffset]);

  const scheduleBySlot = useMemo(() => {
    const slots = new Map();
    visibleOrders.forEach((order) => {
      if (!order.machineId || !Number.isInteger(order.day)) return;
      buildOrderShiftSegments(order).forEach((segment) => {
        const key = `${order.machineId}:${segment.day}:${segment.shift}`;
        const slot = slots.get(key) || [];
        slot.push({ order, segment });
        slots.set(key, slot);
      });
    });
    slots.forEach((slot) => slot.sort((left, right) => left.segment.startMinute - right.segment.startMinute));
    return slots;
  }, [visibleOrders]);

  const shiftLoadBySlot = useMemo(() => {
    const loads = new Map();
    calculatedOrders.forEach((order) => {
      if (!order.machineId || !Number.isInteger(order.day)) return;
      buildOrderShiftSegments(order).forEach((segment) => {
        const key = `${order.machineId}:${segment.day}:${segment.shift}`;
        loads.set(key, (loads.get(key) || 0) + segment.hours);
      });
    });
    return loads;
  }, [calculatedOrders]);

  useEffect(() => () => {
    window.clearTimeout(moveAnimationTimerRef.current);
    window.clearTimeout(flowHoverTimerRef.current);
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setPlanningNow(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const updateOrder = (orderId, patch) => {
    setOrders((current) => current.map((order) => order.id === orderId ? { ...order, ...patch } : order));
  };

  const showOrderFlow = (orderId) => {
    window.clearTimeout(flowHoverTimerRef.current);
    setHoveredFlowOrderId(orderId);
  };

  const scheduleFlowHide = () => {
    window.clearTimeout(flowHoverTimerRef.current);
    flowHoverTimerRef.current = window.setTimeout(() => setHoveredFlowOrderId(null), 600);
  };

  const togglePinnedFlow = (orderId) => {
    window.clearTimeout(flowHoverTimerRef.current);
    setPinnedFlowOrderId((current) => current === orderId ? null : orderId);
    setHoveredFlowOrderId(orderId);
  };

  const tryUpdateOrder = (orderId, patch) => {
    const order = orders.find((item) => item.id === orderId);
    if (!order) return false;
    const candidate = { ...order, ...patch };
    const machine = machines.find((item) => item.id === candidate.machineId);
    if (candidate.machineId && !canMachineProduceOrder(machine, candidate)) {
      setScheduleNotice(`${machine?.name || "Vybraný stroj"} nemôže vyrábať ${candidate.itemCode}.`);
      return false;
    }
    const conflict = findScheduleConflict(candidate, orders, machines);
    if (conflict) {
      setScheduleNotice(`Čas nie je voľný: ${candidate.number} by sa prekrývala so zákazkou ${conflict.number}.`);
      return false;
    }
    const candidateInterval = getOrderScheduleInterval(candidate, machine);
    const predecessorEnd = (candidate.predecessorOrderIds || []).reduce((latestEnd, predecessorId) => {
      const predecessor = orders.find((item) => item.id === predecessorId);
      const predecessorMachine = machines.find((item) => item.id === predecessor?.machineId);
      return Math.max(latestEnd, getOrderScheduleInterval(predecessor, predecessorMachine)?.end || 0);
    }, 0);
    if (candidateInterval && predecessorEnd && candidateInterval.start < predecessorEnd) {
      setScheduleNotice(`${candidate.number} môže začať až po dokončení nadväzujúceho vstupného materiálu.`);
      return false;
    }
    updateOrder(orderId, patch);
    setScheduleNotice("");
    return true;
  };

  const buildAutomaticSchedule = (sourceOrders) => {
    let scheduledOrders = sourceOrders.map((order) => ({ ...order, predecessorOrderIds: [...(order.predecessorOrderIds || [])] }));
    const pendingIds = new Set(scheduledOrders.filter((order) => !order.machineId || !Number.isInteger(order.day)).map((order) => order.id));
    const priorityRank = { high: 0, normal: 1, low: 2 };
    let assigned = 0;
    let risk = 0;
    let blocked = 0;

    while (pendingIds.size) {
      const pending = scheduledOrders
        .filter((order) => pendingIds.has(order.id))
        .sort((left, right) => {
          const leftWaiting = (left.predecessorOrderIds || []).filter((id) => pendingIds.has(id)).length;
          const rightWaiting = (right.predecessorOrderIds || []).filter((id) => pendingIds.has(id)).length;
          return leftWaiting - rightWaiting || String(left.dueDate || "").localeCompare(String(right.dueDate || "")) || (priorityRank[left.priority] ?? 1) - (priorityRank[right.priority] ?? 1);
        });
      const order = pending.find((item) => !(item.predecessorOrderIds || []).some((id) => pendingIds.has(id))) || pending[0];
      pendingIds.delete(order.id);
      const compatibleMachines = activeMachines.filter((machine) => machine.productIds?.includes(order.productId));
      if (!compatibleMachines.length) {
        blocked += 1;
        continue;
      }

      const predecessorEnd = (order.predecessorOrderIds || []).reduce((latestEnd, predecessorId) => {
        const predecessor = scheduledOrders.find((item) => item.id === predecessorId);
        const predecessorMachine = machines.find((item) => item.id === predecessor?.machineId);
        return Math.max(latestEnd, getOrderScheduleInterval(predecessor, predecessorMachine)?.end || 0);
      }, 0);
      let best = null;
      compatibleMachines.forEach((machine) => {
        const start = Math.max(0, predecessorEnd);
        const candidate = {
          ...order,
          machineId: machine.id,
          day: Math.floor(start / MINUTES_PER_DAY),
          startOffsetMinutes: start % MINUTES_PER_DAY,
          shift: getShiftFromStartOffset(start % MINUTES_PER_DAY)
        };
        const resolved = findFirstAvailableSchedule(candidate, scheduledOrders, machines);
        const interval = getOrderScheduleInterval(resolved, machine);
        if (!interval || resolved.day >= DAY_COUNT) return;
        if (!best || interval.end < best.interval.end) best = { order: resolved, interval };
      });
      if (!best) {
        blocked += 1;
        continue;
      }
      const missesDueDate = best.interval.end > getOrderDueMinute(order, week);
      const nextOrder = { ...best.order, status: missesDueDate ? "risk" : order.status === "running" ? "running" : "confirmed" };
      scheduledOrders = scheduledOrders.map((item) => item.id === order.id ? nextOrder : item);
      assigned += 1;
      if (missesDueDate) risk += 1;
    }

    return {
      orders: scheduledOrders,
      message: `Automatický plán priradil ${assigned} zákaziek podľa materiálovej nadväznosti a termínu.${risk ? ` ${risk} končí po due date.` : ""}${blocked ? ` ${blocked} zostáva v backlogu pre chýbajúci stroj alebo kapacitu.` : ""}`
    };
  };

  const handleAutomaticAssignment = () => {
    const result = buildAutomaticSchedule(orders);
    setOrders(result.orders);
    setScheduleNotice(result.message);
  };

  const handleCreateOrder = (draft, autoAssign) => {
    const product = products.find((item) => item.id === draft.productId);
    if (!product) return;
    const dueDay = getPlanDayFromDate(draft.dueDate, week);
    const newOrderId = `po-plan-${Date.now()}`;
    const order = hydrateOrderTiming({
      id: newOrderId,
      number: draft.number,
      productId: product.id,
      itemCode: product.itemCode,
      itemName: product.itemName,
      quantity: draft.quantity,
      completedQuantity: 0,
      cycleTimeSec: product.cycleTimeSec,
      setupMinutes: product.setupMinutes,
      machineId: autoAssign ? null : draft.machineId,
      day: autoAssign ? null : draft.day,
      shift: draft.shift,
      startOffsetMinutes: getDefaultStartOffset(draft.shift),
      priority: draft.priority,
      status: "draft",
      dueDay,
      dueDate: draft.dueDate,
      predecessorOrderIds: [...draft.predecessorOrderIds],
      progress: 0
    }, machines);
    const newInputOrders = draft.processInputProductIds
      .map((inputProductId, index) => products.find((item) => item.id === inputProductId))
      .filter(Boolean)
      .map((inputProduct, index) => hydrateOrderTiming({
        id: `${newOrderId}-input-${index + 1}`,
        number: `${draft.number}-VST-${index + 1}`,
        productId: inputProduct.id,
        itemCode: inputProduct.itemCode,
        itemName: inputProduct.itemName,
        quantity: order.quantity,
        completedQuantity: 0,
        cycleTimeSec: inputProduct.cycleTimeSec,
        setupMinutes: inputProduct.setupMinutes,
        machineId: null,
        day: null,
        shift: 1,
        startOffsetMinutes: getDefaultStartOffset(1),
        priority: draft.priority,
        status: "draft",
        dueDay: Math.max(0, dueDay - 1),
        dueDate: toDateInputValue(week[Math.max(0, Math.min(4, dueDay - 1))] || week[0]),
        predecessorOrderIds: [],
        progress: 0
      }, machines));
    const orderWithInputs = { ...order, predecessorOrderIds: [...order.predecessorOrderIds, ...newInputOrders.map((inputOrder) => inputOrder.id)] };
    const nextOrders = [...orders, ...newInputOrders, orderWithInputs];
    setDemoOrdersCleared(false);
    if (autoAssign) {
      const result = buildAutomaticSchedule(nextOrders);
      setOrders(result.orders);
      setScheduleNotice(`${newInputOrders.length ? `Potvrdené vstupy (${newInputOrders.map((item) => item.itemCode).join(", ")}) boli zaradené pred hlavnú zákazku. ` : ""}${result.message}`);
    } else {
      setOrders(nextOrders);
      if (newInputOrders.length) setScheduleNotice(`Vstupné zákazky ${newInputOrders.map((item) => item.number).join(", ")} boli pridané do backlogu.`);
    }
    setIsNewOrderOpen(false);
    setMachineOrdersInitialMachineId(null);
    setMachineOrdersInitialDay(null);
    setMachineOrdersInitialShift(null);
  };

  const deleteSelectedOrder = () => {
    if (!selectedOrder || !window.confirm(`Naozaj chceš vymazať zákazku ${selectedOrder.number}?`)) return;
    setOrders((current) => current.filter((order) => order.id !== selectedOrder.id));
    if (pinnedFlowOrderId === selectedOrder.id) setPinnedFlowOrderId(null);
    if (hoveredFlowOrderId === selectedOrder.id) setHoveredFlowOrderId(null);
    setSelectedOrderId(null);
    setScheduleNotice("");
  };

  const deleteAllOrders = () => {
    if (!orders.length) return;
    const confirmed = window.confirm(`Vymazať všetkých ${orders.length} zákaziek z tohto demo scenára? Zmena platí iba do obnovenia stránky; po refreshe sa vzorové zákazky vrátia.`);
    if (!confirmed) return;
    setOrders([]);
    setDemoOrdersCleared(true);
    setSelectedOrderId(null);
    setPinnedFlowOrderId(null);
    setHoveredFlowOrderId(null);
    setScheduleNotice("");
  };

  const openOrder = (orderId) => {
    setScheduleNotice("");
    setSelectedOrderId(orderId);
  };

  const handleDragStart = (event, orderId) => {
    setDraggedOrderId(orderId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", orderId);
  };

  const moveOrderToCell = (orderId, machineId, day, shift = null) => {
    const order = orders.find((item) => item.id === orderId);
    const machine = machines.find((item) => item.id === machineId);
    if (!canMachineProduceOrder(machine, order)) return;
    const startOffsetMinutes = Number.isInteger(shift) ? getDefaultStartOffset(shift) : getOrderStartOffset(order);
    const moved = tryUpdateOrder(orderId, { machineId, day, shift: getShiftFromStartOffset(startOffsetMinutes), startOffsetMinutes, status: "draft" });
    window.clearTimeout(moveAnimationTimerRef.current);
    if (moved) {
      setRecentlyMovedOrderId(orderId);
      moveAnimationTimerRef.current = window.setTimeout(() => setRecentlyMovedOrderId(null), 700);
    }
    setDraggedOrderId(null);
  };

  const handleDrop = (event, machineId, day, shift = null) => {
    event.preventDefault();
    moveOrderToCell(event.dataTransfer.getData("text/plain") || draggedOrderId, machineId, day, shift);
  };

  return (
    <motion.section className="scherdel-planning" aria-label="Testovací modul plánovania výroby" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, ease: "easeOut" }}>
      <motion.div className="scherdel-planning-demo-banner" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.18 }}>
        <span><Sparkles size={15} />PLANNING LAB</span>
        <p><b>Modelový výrobný týždeň</b><small>2 odberateľské objednávky · 8 dávok · 15 polotovarov na rám · zváranie · kontrola · expedícia</small></p>
        <em>Demo dáta</em>
      </motion.div>

      <motion.header className="scherdel-planning-header" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08, duration: 0.45 }}>
        <div>
          <span className="planning-kicker"><i aria-hidden="true" /> Production planning</span>
          <h2>{activeModule === "plan" ? "Týždeň výroby, bez slepých miest." : activeModule === "resources" ? "Kapacita, ktorú možno reálne naplánovať." : "Od polotovaru po expedíciu."}</h2>
          <p>{activeModule === "plan" ? "Zákazky sú zoradené podľa kapacity, materiálovej nadväznosti a termínu odovzdania." : activeModule === "resources" ? "Pracoviská, stroje a ich dostupnosť tvoria pevný základ výrobného plánu." : "Materiálový register ukazuje, čo sa vyrába, kde sa to vyrába a na ktorú operáciu výstup pokračuje."}</p>
        </div>
        {activeModule === "plan" ? <div className="planning-header-actions"><button type="button" className="scherdel-plan-danger" onClick={deleteAllOrders} disabled={!orders.length} title="Vymaže zákazky len do obnovenia stránky"><Trash2 size={15} />Vymazať všetky</button><button type="button" className="scherdel-plan-secondary" onClick={handleAutomaticAssignment}><Sparkles size={17} />Automatické priradenie</button><button type="button" className="scherdel-plan-primary" onClick={() => { setMachineOrdersInitialMachineId(null); setMachineOrdersInitialDay(null); setMachineOrdersInitialShift(null); setIsNewOrderOpen(true); }}><Plus size={17} />Nová zákazka</button></div> : null}
      </motion.header>

      <motion.nav className="scherdel-planning-tabs" aria-label="Sekcie plánovania výroby" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.14 }}>
        <button type="button" className={activeModule === "plan" ? "active" : ""} onClick={() => setActiveModule("plan")}><CalendarDays size={16} /><span><b>Výrobný plán</b><small>Zákazky a kapacity</small></span></button>
        <button type="button" className={activeModule === "machineOrders" ? "active" : ""} onClick={() => setActiveModule("machineOrders")}><Boxes size={16} /><span><b>Materiály</b><small>Register a nadväznosti</small></span></button>
        <button type="button" className={activeModule === "resources" ? "active" : ""} onClick={() => setActiveModule("resources")}><Settings2 size={16} /><span><b>Stroje a pracoviská</b><small>Konfigurácia zdrojov</small></span></button>
      </motion.nav>

      {activeModule === "plan" ? <>
      <div className="scherdel-plan-kpis">
        <article><span className="icon blue"><CalendarDays /></span><div><small>V pláne</small><strong>{scheduledAll.length}</strong><p>výrobných zákaziek</p></div></article>
        <article><span className="icon green"><Gauge /></span><div><small>Vyťaženie kapacity</small><strong>{overallLoad} %</strong><p>{plannedHours} z {totalCapacity} hodín</p></div></article>
        <article className={riskCount ? "attention" : ""}><span className="icon orange"><AlertTriangle /></span><div><small>Riziko termínu</small><strong>{riskCount}</strong><p>zákazky vyžadujú zásah</p></div></article>
        <article><span className="icon violet"><Layers3 /></span><div><small>Backlog</small><strong>{calculatedOrders.filter((order) => !order.machineId).length}</strong><p>čaká na rozplánovanie</p></div></article>
      </div>

      <div className="scherdel-planning-toolbar">
        <div className="week-switcher">
          <button type="button" onClick={() => setWeekOffset((value) => value - 1)} aria-label="Predchádzajúci týždeň"><ArrowLeft size={17} /></button>
          <button type="button" className="current-week" onClick={() => setWeekOffset(0)}><CalendarDays size={16} /><span>{longDateFormatter.format(week[0])} – {longDateFormatter.format(week[4])}</span></button>
          <button type="button" onClick={() => setWeekOffset((value) => value + 1)} aria-label="Nasledujúci týždeň"><ArrowRight size={17} /></button>
          {weekOffset !== 0 ? <button type="button" className="today" onClick={() => setWeekOffset(0)}>Aktuálny týždeň</button> : null}
        </div>
        <div className="calendar-view-switch" role="group" aria-label="Zobrazenie výrobného kalendára">
          <button type="button" className={calendarView === "day" ? "active" : ""} aria-pressed={calendarView === "day"} onClick={() => setCalendarView("day")}><CalendarDays size={14} />Denný pohľad</button>
          <button type="button" className={calendarView === "shift" ? "active" : ""} aria-pressed={calendarView === "shift"} onClick={() => setCalendarView("shift")}><Layers3 size={14} />Podľa zmien</button>
        </div>
        <label className="planning-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Hľadať zákazku alebo výrobok" /></label>
        <div className="planning-filters" role="group" aria-label="Filtrovanie plánu">
          {[['all', 'Všetko'], ['high', 'Vysoká priorita'], ['risk', 'Riziko']].map(([key, label]) => <button type="button" key={key} className={filter === key ? "active" : ""} onClick={() => setFilter(key)}>{label}</button>)}
        </div>
      </div>
      {scheduleNotice ? <div className="planning-schedule-notice" role="status"><Sparkles size={16} /><span><b>Výrobný plánovač</b><small>{scheduleNotice}</small></span><button type="button" onClick={() => setScheduleNotice("")} aria-label="Zavrieť upozornenie"><X size={15} /></button></div> : null}

      <div className="scherdel-planning-layout">
        <aside className="scherdel-plan-backlog">
          <div className="backlog-head"><div><PackagePlus size={18} /><span><strong>Backlog</strong><small>Nenaplánované zákazky</small></span></div><b>{backlog.length}</b></div>
          <p>{calendarView === "shift" ? "Potiahni zákazku na konkrétny stroj, deň a pracovnú zmenu." : "Potiahni zákazku na konkrétny stroj a deň."}</p>
          <div className="backlog-list">
            {backlogGroups.map(([date, ordersForDate]) => <section className="backlog-day-group" key={date}>
              <header><b>{date === "bez-terminu" ? "Bez termínu" : weekdayFormatter.format(new Date(`${date}T12:00:00`))}</b><span>{date === "bez-terminu" ? "" : dateFormatter.format(new Date(`${date}T12:00:00`))}</span><em>{ordersForDate.length}</em></header>
              <div>{ordersForDate.map((order) => <PlanningOrderCard key={order.id} order={order} compact isDragging={order.id === draggedOrderId} justMoved={order.id === recentlyMovedOrderId} onOpen={openOrder} onMoveSelect={(orderId) => setDraggedOrderId((current) => current === orderId ? null : orderId)} onDragStart={handleDragStart} onDragEnd={() => setDraggedOrderId(null)} />)}</div>
            </section>)}
            {!backlog.length ? <div className="backlog-empty"><CheckCircle2 size={24} /><strong>{demoOrdersCleared && !orders.length ? "Demo zákazky vymazané" : "Všetko naplánované"}</strong><span>{demoOrdersCleared && !orders.length ? "Po obnovení stránky sa vzorový scenár vráti." : "Vo filtri nie sú voľné zákazky."}</span></div> : null}
          </div>
          <div className="backlog-hint"><Sparkles size={15} /><span><b>Ďalší krok</b>Automatický návrh poradia podľa termínu, kapacity a prestavieb.</span></div>
        </aside>

        <div className="scherdel-plan-board-wrap">
          <div className={`scherdel-plan-board ${calendarView === "shift" ? "shift-mode" : "day-mode"}`} style={{ "--day-count": DAY_COUNT }}>
            <div className="board-corner"><Factory size={16} /><span>Stroj / kapacita</span></div>
            {week.map((date, day) => <div className={`board-day ${sameCalendarDay(date, new Date()) ? "today" : ""}`} key={date.toISOString()}><span>{weekdayFormatter.format(date)}</span><strong>{dateFormatter.format(date)}</strong><small>{calendarView === "shift" ? `${SHIFTS.length} zmeny` : day === 4 ? "Piatok" : "Denný plán"}</small></div>)}

            {activeMachines.map((machine) => {
              const load = machineLoads.get(machine.id);
              const queue = machineQueues.get(machine.id);
              const loadTone = getLoadTone(load.percent);
              const isCompatibleDropTarget = draggedOrder ? canMachineProduceOrder(machine, draggedOrder) : false;
              return <div className="board-row" key={machine.id}>
                <div className={`board-machine ${draggedOrder ? (isCompatibleDropTarget ? "drop-compatible" : "drop-incompatible") : ""}`}>
                  <span className="machine-code">{machine.code}</span>
                  <strong>{machine.name}</strong>
                  <small>{workplaceById.get(machine.workplaceId)?.name || "Nepriradené pracovisko"}</small>
                  <div className={`machine-load ${loadTone}`}><span><i style={{ width: `${Math.min(load.percent, 100)}%` }} /></span><b>{load.percent} %</b></div>
                  <div className="machine-now-next">
                    <span className={queue?.current ? "active" : "idle"}><i>Teraz</i><b title={queue?.current?.order.itemName}>{queue?.current ? `${queue.current.order.number} · do ${formatPlanMoment(queue.current.interval.end, week)}` : "Stroj je voľný"}</b></span>
                    <span><i>Nasleduje</i><b title={queue?.next?.order.itemName}>{queue?.next ? `${queue.next.order.number} · ${formatPlanMoment(queue.next.interval.start, week)}` : "Bez ďalšej zákazky"}</b></span>
                  </div>
                  {draggedOrder ? <span className={`drop-machine-status ${isCompatibleDropTarget ? "allowed" : "blocked"}`} title={isCompatibleDropTarget ? `${machine.name} môže vyrábať ${draggedOrder.itemCode}` : `${machine.name} nevyrába ${draggedOrder.itemCode}`}>{isCompatibleDropTarget ? <CheckCircle2 size={11} /> : <Ban size={11} />}{isCompatibleDropTarget ? "Povolené" : "Blokované"}</span> : null}
                </div>
                {week.map((date, day) => {
                  if (calendarView === "day") {
                    const cellOrders = scheduled
                      .filter((order) => order.machineId === machine.id && order.day === day)
                      .sort((left, right) => getOrderStartOffset(left) - getOrderStartOffset(right));
                    return <div
                      className={`board-cell ${sameCalendarDay(date, new Date()) ? "today" : ""} ${draggedOrder ? (isCompatibleDropTarget ? "drop-compatible" : "drop-incompatible") : ""}`}
                      key={`${machine.id}-${day}`}
                      onDragOver={(event) => {
                        event.dataTransfer.dropEffect = isCompatibleDropTarget ? "move" : "none";
                        if (isCompatibleDropTarget) event.preventDefault();
                      }}
                      onDrop={(event) => { if (isCompatibleDropTarget) handleDrop(event, machine.id, day); }}
                      onClick={() => { if (draggedOrder && isCompatibleDropTarget) moveOrderToCell(draggedOrder.id, machine.id, day); }}
                    >
                      <button type="button" className="cell-add" onClick={(event) => { event.stopPropagation(); setMachineOrdersInitialMachineId(machine.id); setMachineOrdersInitialDay(day); setMachineOrdersInitialShift(null); setIsNewOrderOpen(true); }} aria-label={`Pridať zákazku na ${machine.name}, ${dateFormatter.format(date)}`}><Plus size={13} /></button>
                      {cellOrders.map((order) => <PlanningOrderCard key={order.id} order={order} isDragging={order.id === draggedOrderId} justMoved={order.id === recentlyMovedOrderId} flowPinned={pinnedFlowOrderId === order.id} onOpen={openOrder} onMoveSelect={(orderId) => setDraggedOrderId((current) => current === orderId ? null : orderId)} onDragStart={handleDragStart} onDragEnd={() => setDraggedOrderId(null)} onFlowEnter={showOrderFlow} onFlowLeave={scheduleFlowHide} onToggleFlow={togglePinnedFlow} />)}
                    </div>;
                  }

                  return <div
                    className={`board-cell shift-layout ${sameCalendarDay(date, new Date()) ? "today" : ""} ${draggedOrder ? (isCompatibleDropTarget ? "drop-compatible" : "drop-incompatible") : ""}`}
                    key={`${machine.id}-${day}`}
                  >
                    {SHIFTS.map((shift) => {
                      const slotKey = `${machine.id}:${day}:${shift.value}`;
                      const slotSegments = scheduleBySlot.get(slotKey) || [];
                      const shiftHours = shiftLoadBySlot.get(slotKey) || 0;
                      const shiftLoad = Math.round(shiftHours / 8 * 100);
                      const shiftLoadTone = getShiftLoadTone(shiftLoad);
                      return <div
                        className={`board-shift-lane shift-${shift.value}`}
                        key={shift.value}
                        onDragOver={(event) => {
                          event.dataTransfer.dropEffect = isCompatibleDropTarget ? "move" : "none";
                          if (isCompatibleDropTarget) event.preventDefault();
                        }}
                        onDrop={(event) => { if (isCompatibleDropTarget) handleDrop(event, machine.id, day, shift.value); }}
                        onClick={() => { if (draggedOrder && isCompatibleDropTarget) moveOrderToCell(draggedOrder.id, machine.id, day, shift.value); }}
                      >
                        <div className="shift-lane-head">
                          <span className="shift-name"><b>{shift.label}</b><small>{shift.time}</small></span>
                          <span className={`shift-utilization ${shiftLoadTone}`} title={`${shiftHours.toFixed(1)} z 8 hodín`} aria-label={`Využitie zmeny ${shiftLoad} percent`}><i><em style={{ width: `${Math.min(shiftLoad, 100)}%` }} /></i><b>{shiftLoad} %</b></span>
                        </div>
                        <button type="button" className="cell-add" onClick={(event) => { event.stopPropagation(); setMachineOrdersInitialMachineId(machine.id); setMachineOrdersInitialDay(day); setMachineOrdersInitialShift(shift.value); setIsNewOrderOpen(true); }} aria-label={`Pridať zákazku na ${machine.name}, ${dateFormatter.format(date)}, ${shift.label}`}><Plus size={13} /></button>
                        {slotSegments.map(({ order, segment }) => <PlanningOrderCard key={`${order.id}-${segment.part}`} order={order} segment={segment} isDragging={order.id === draggedOrderId} justMoved={order.id === recentlyMovedOrderId} flowPinned={pinnedFlowOrderId === order.id} onOpen={openOrder} onMoveSelect={(orderId) => setDraggedOrderId((current) => current === orderId ? null : orderId)} onDragStart={handleDragStart} onDragEnd={() => setDraggedOrderId(null)} onFlowEnter={showOrderFlow} onFlowLeave={scheduleFlowHide} onToggleFlow={togglePinnedFlow} />)}
                      </div>;
                    })}
                  </div>;
                })}
              </div>;
            })}
          </div>
        </div>
      </div>

      {activeFlowOrder && (activeFlowOrder.predecessorOrders?.length || activeFlowOrder.successorOrders?.length) ? <FlowDependencyPanel order={activeFlowOrder} machines={machines} week={week} pinned={pinnedFlowOrderId === activeFlowOrder.id} onTogglePin={togglePinnedFlow} onOpen={openOrder} onMouseEnter={() => window.clearTimeout(flowHoverTimerRef.current)} onMouseLeave={scheduleFlowHide} /> : null}

      <div className="scherdel-plan-legend">
        <span><i className="running" />Vo výrobe</span><span><i className="confirmed" />Potvrdené</span><span><i className="draft" />Návrh</span><span><i className="risk" />Riziko termínu</span><small>{calendarView === "shift" ? "Zmena má 8 hodín; dlhšia zákazka pokračuje v ďalšej zmene." : "Tip: zákazky môžeš presúvať medzi bunkami pomocou drag-and-drop."}</small>
      </div>

      {selectedOrder ? <div className="scherdel-plan-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedOrderId(null); }}>
        <aside className="scherdel-plan-drawer" aria-label={`Detail zákazky ${selectedOrder.number}`}>
          <header><div><span>Detail výrobnej zákazky</span><h3>{selectedOrder.number}</h3></div><button type="button" onClick={() => setSelectedOrderId(null)} aria-label="Zavrieť detail"><X size={19} /></button></header>
          <div className={`drawer-status ${selectedOrder.status}`}><span>{STATUS_LABELS[selectedOrder.status]}</span><b>{PRIORITY_LABELS[selectedOrder.priority]} priorita</b></div>
          <div className="drawer-product"><small>{selectedOrder.itemCode}</small><strong>{selectedOrder.itemName}</strong>{selectedOrder.customerOrderNumber ? <span>Odberateľská objednávka: {selectedOrder.customerOrderNumber}</span> : null}<span>{numberFormatter.format(selectedOrder.quantity)} ks · plán {formatHours(selectedOrder.metrics.totalHours)} h · zostáva {formatHours(selectedOrder.metrics.remainingHours)} h</span></div>
          {scheduleNotice ? <div className="drawer-warning conflict"><AlertTriangle size={17} /><span><strong>Čas sa nedá uložiť</strong>{scheduleNotice}</span></div> : null}
          {selectedOrder.status === "risk" ? <div className="drawer-warning"><AlertTriangle size={17} /><span><strong>Riziko nesplnenia termínu</strong>Kapacita stroja alebo materiálová nadväznosť presahuje due date {selectedOrder.dueDate ? dateFormatter.format(new Date(`${selectedOrder.dueDate}T12:00:00`)) : "–"}.</span></div> : null}
          {(selectedOrder.inputProducts.length || selectedOrder.downstreamProducts.length) ? <section className="drawer-material-chain"><header><GitBranch size={16} /><div><b>Materiálové reťazenie</b><span>Vstupy a nasledujúce použitie materiálu</span></div></header>{selectedOrder.inputProducts.length ? <div><small>Do zákazky vstupuje</small><p>{selectedOrder.inputProducts.map((product) => <span key={product.id}>{product.itemCode} · {product.operation}</span>)}</p></div> : null}{selectedOrder.downstreamProducts.length ? <div><small>Výstup ďalej vstupuje do</small><p>{selectedOrder.downstreamProducts.map((product) => <span key={product.id}>{product.itemCode} · {product.operation}</span>)}</p></div> : null}</section> : null}
          <div className="drawer-form">
            <label><span>Priradený stroj</span><select value={selectedOrder.machineId || ""} onChange={(event) => tryUpdateOrder(selectedOrder.id, { machineId: event.target.value || null, day: event.target.value ? (selectedOrder.day ?? 0) : null })}><option value="">Nenaplánované</option>{selectedOrderMachines.map((machine) => <option key={machine.id} value={machine.id}>{machine.code} · {machine.name}</option>)}</select></label>
            <label><span>Plánovaný deň</span><select value={selectedOrder.day ?? ""} disabled={!selectedOrder.machineId} onChange={(event) => tryUpdateOrder(selectedOrder.id, { day: Number(event.target.value) })}><option value="">Vybrať deň</option>{week.map((date, day) => <option key={date.toISOString()} value={day}>{weekdayFormatter.format(date)} {dateFormatter.format(date)}</option>)}</select></label>
            <div className="drawer-form-row"><label><span>Pracovná zmena</span><select value={selectedOrder.shift} disabled={!selectedOrder.machineId} onChange={(event) => { const shift = Number(event.target.value); tryUpdateOrder(selectedOrder.id, { shift, startOffsetMinutes: getDefaultStartOffset(shift) }); }}>{SHIFTS.map((shift) => <option key={shift.value} value={shift.value}>{shift.label} · {shift.time}</option>)}</select></label><label><span>Začiatok výroby</span><input type="time" step="900" disabled={!selectedOrder.machineId} value={startOffsetToClockTime(getOrderStartOffset(selectedOrder))} onChange={(event) => { const startOffsetMinutes = clockTimeToStartOffset(event.target.value); if (startOffsetMinutes !== null) tryUpdateOrder(selectedOrder.id, { startOffsetMinutes, shift: getShiftFromStartOffset(startOffsetMinutes) }); }} /><small className="schedule-end-hint">{formatOrderEndHint(selectedOrder)}</small></label></div>
            <div className="drawer-form-row"><label><span>Plánované kusy</span><input type="number" min="0" step="100" value={selectedOrder.quantity} onChange={(event) => { const quantity = Math.max(0, Number(event.target.value) || 0); tryUpdateOrder(selectedOrder.id, { quantity, completedQuantity: Math.min(selectedOrder.metrics.completedQuantity, quantity) }); }} /></label><label><span>Vyrobené kusy</span><input type="number" min="0" max={selectedOrder.quantity} step="100" value={selectedOrder.metrics.completedQuantity} onChange={(event) => updateOrder(selectedOrder.id, { completedQuantity: Math.min(selectedOrder.quantity, Math.max(0, Number(event.target.value) || 0)) })} /></label></div>
            <div className="drawer-form-row"><label><span>Cyklus (sekúnd / kus)</span><input type="number" min="0.01" step="0.01" value={selectedOrder.cycleTimeSec} onChange={(event) => tryUpdateOrder(selectedOrder.id, { cycleTimeSec: Math.max(0.01, Number(event.target.value) || 0.01) })} /></label><label><span>Prestavba (min)</span><input type="number" min="0" step="5" value={selectedOrder.setupMinutes} onChange={(event) => tryUpdateOrder(selectedOrder.id, { setupMinutes: Math.max(0, Number(event.target.value) || 0) })} /></label></div>
            <div className="drawer-calculation"><span><Clock3 size={15} />Vypočítaný čas</span><strong>{formatHours(selectedOrder.metrics.totalHours)} h</strong><small>Prestavba + (kusy × cyklus ÷ efektivita stroja {selectedOrder.metrics.efficiencyPercent} %)</small></div>
            <div className="drawer-form-row"><label><span>Due date / termín dokončenia</span><input type="date" value={selectedOrder.dueDate || ""} onChange={(event) => updateOrder(selectedOrder.id, { dueDate: event.target.value, dueDay: getPlanDayFromDate(event.target.value, week) })} /></label><label><span>Priorita</span><select value={selectedOrder.priority} onChange={(event) => updateOrder(selectedOrder.id, { priority: event.target.value })}><option value="high">Vysoká</option><option value="normal">Normálna</option><option value="low">Nízka</option></select></label></div>
            <label><span>Stav plánu</span><select value={selectedOrder.status} onChange={(event) => updateOrder(selectedOrder.id, { status: event.target.value })}><option value="draft">Návrh</option><option value="confirmed">Potvrdené</option><option value="risk">Riziko</option><option value="running">Vo výrobe</option></select></label>
            {selectedOrder.inputProducts.length ? <fieldset className="drawer-predecessors"><legend>Nadväzujúce vstupné zákazky</legend>{calculatedOrders.filter((candidate) => selectedOrder.inputProducts.some((product) => product.id === candidate.productId) && candidate.id !== selectedOrder.id).map((candidate) => <label key={candidate.id} className={(selectedOrder.predecessorOrderIds || []).includes(candidate.id) ? "selected" : ""}><input type="checkbox" checked={(selectedOrder.predecessorOrderIds || []).includes(candidate.id)} onChange={() => updateOrder(selectedOrder.id, { predecessorOrderIds: (selectedOrder.predecessorOrderIds || []).includes(candidate.id) ? selectedOrder.predecessorOrderIds.filter((id) => id !== candidate.id) : [...(selectedOrder.predecessorOrderIds || []), candidate.id] })} /><span><b>{candidate.number}</b><small>{candidate.itemCode} · {candidate.itemName}</small></span></label>)}</fieldset> : null}
          </div>
          <footer><span><Clock3 size={14} />Demo zmeny sa neukladajú</span><div><button type="button" className="drawer-delete" onClick={deleteSelectedOrder}><Trash2 size={15} />Zmazať</button><button type="button" onClick={() => setSelectedOrderId(null)}><CheckCircle2 size={16} />Hotovo</button></div></footer>
        </aside>
      </div> : null}

      </> : activeModule === "resources" ? <ScherdelResourceConfiguration machines={machines} setMachines={setMachines} workplaces={workplaces} setWorkplaces={setWorkplaces} orders={orders} products={products} /> : <ScherdelMaterialRegistry products={products} setProducts={setProducts} machines={machines} setMachines={setMachines} orders={orders} />}

      {isNewOrderOpen ? <ScherdelNewProductionOrderModal products={products} orders={orders} machines={machines} week={week} initialMachineId={machineOrdersInitialMachineId} initialDay={machineOrdersInitialDay} initialShift={machineOrdersInitialShift} onClose={() => setIsNewOrderOpen(false)} onCreate={handleCreateOrder} /> : null}
    </motion.section>
  );
}
