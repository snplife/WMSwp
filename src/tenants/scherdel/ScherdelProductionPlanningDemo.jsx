import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, ArrowLeft, ArrowRight, Ban, CalendarDays, CheckCircle2, Clock3,
  ClipboardList, Factory, Gauge, GripVertical, Layers3, PackagePlus, Plus, Search, Settings2, Sparkles, Trash2, X
} from "lucide-react";
import ScherdelMachineOrders from "./ScherdelMachineOrders";
import ScherdelResourceConfiguration from "./ScherdelResourceConfiguration";
import { calculateOrderMetrics, formatHours, hydrateOrderTiming } from "./productionPlanningCalculations";
import { SCHERDEL_PRODUCT_CATALOG } from "./scherdelProductCatalog";
import "./scherdelProductionPlanningDemo.css";

const DAY_COUNT = 5;
const SHIFTS = [
  { value: 1, label: "Ranná", time: "06:30 – 14:30" },
  { value: 2, label: "Poobedná", time: "14:30 – 22:30" },
  { value: 3, label: "Nočná", time: "22:30 – 06:30" }
];
const INITIAL_WORKPLACES = [
  { id: "assembly", name: "Montážna linka", area: "Hala A", supervisor: "", active: true },
  { id: "forming", name: "Tvárnenie drôtu", area: "Hala A", supervisor: "", active: true },
  { id: "finishing", name: "Dokončenie", area: "Hala B", supervisor: "", active: true },
  { id: "shipping", name: "Expedícia", area: "Hala B", supervisor: "", active: true }
];
const INITIAL_MACHINES = [
  { id: "rt-01", code: "RT-01", name: "RoundTakt", workplaceId: "assembly", shiftCount: 3, hoursPerDay: 24, targetEfficiency: 88, productIds: ["product-881-042", "product-611-088", "product-230-119"], active: true },
  { id: "p-01", code: "P-01", name: "Pružinový automat 01", workplaceId: "forming", shiftCount: 3, hoursPerDay: 24, targetEfficiency: 85, productIds: ["product-370-214", "product-105-776", "product-729-330", "product-504-442"], active: true },
  { id: "p-02", code: "P-02", name: "Pružinový automat 02", workplaceId: "forming", shiftCount: 3, hoursPerDay: 24, targetEfficiency: 82, productIds: ["product-370-214", "product-442-901", "product-504-442"], active: true },
  { id: "l-01", code: "L-01", name: "Laser / kontrola", workplaceId: "finishing", shiftCount: 2, hoursPerDay: 16, targetEfficiency: 90, productIds: ["product-881-042", "product-118-907"], active: true },
  { id: "b-01", code: "B-01", name: "Balenie", workplaceId: "shipping", shiftCount: 2, hoursPerDay: 16, targetEfficiency: 92, productIds: ["product-105-776", "product-611-088", "product-230-119"], active: true }
];
const PRIORITY_LABELS = { high: "Vysoká", normal: "Normálna", low: "Nízka" };
const STATUS_LABELS = { confirmed: "Potvrdené", draft: "Návrh", risk: "Riziko", running: "Vo výrobe" };

const INITIAL_ORDERS = [
  { id: "po-1001", number: "VP-2026-1102", itemCode: "ID 370-214", itemName: "Tlačná pružina 1.4310", quantity: 18500, machineId: "p-01", day: 0, shift: 1, duration: 7.5, priority: "high", status: "running", dueDay: 1, progress: 46 },
  { id: "po-1002", number: "VP-2026-1103", itemCode: "ID 881-042", itemName: "Torzné rameno L", quantity: 8200, machineId: "rt-01", day: 0, shift: 2, duration: 8, priority: "normal", status: "confirmed", dueDay: 2, progress: 0 },
  { id: "po-1003", number: "VP-2026-1104", itemCode: "ID 442-901", itemName: "Poistná pružina", quantity: 24000, machineId: "p-02", day: 0, shift: 1, duration: 12, priority: "high", status: "risk", dueDay: 0, progress: 18 },
  { id: "po-1004", number: "VP-2026-1105", itemCode: "ID 105-776", itemName: "Pružný kontakt", quantity: 12000, machineId: "p-01", day: 1, shift: 1, duration: 6, priority: "normal", status: "confirmed", dueDay: 2, progress: 0 },
  { id: "po-1005", number: "VP-2026-1106", itemCode: "ID 370-214", itemName: "Tlačná pružina 1.4310", quantity: 15500, machineId: "p-02", day: 1, shift: 2, duration: 8, priority: "normal", status: "draft", dueDay: 3, progress: 0 },
  { id: "po-1006", number: "VP-2026-1107", itemCode: "ID 611-088", itemName: "Zostava klipu", quantity: 6800, machineId: "rt-01", day: 2, shift: 1, duration: 9.5, priority: "high", status: "confirmed", dueDay: 3, progress: 0 },
  { id: "po-1007", number: "VP-2026-1108", itemCode: "ID 881-042", itemName: "Torzné rameno L", quantity: 8200, machineId: "l-01", day: 2, shift: 2, duration: 5, priority: "normal", status: "confirmed", dueDay: 3, progress: 0 },
  { id: "po-1008", number: "VP-2026-1109", itemCode: "ID 105-776", itemName: "Pružný kontakt", quantity: 12000, machineId: "b-01", day: 3, shift: 1, duration: 4.5, priority: "low", status: "draft", dueDay: 4, progress: 0 },
  { id: "po-1009", number: "VP-2026-1110", itemCode: "ID 729-330", itemName: "Vodiaca pružina", quantity: 31000, machineId: "p-01", day: 3, shift: 2, duration: 11, priority: "high", status: "risk", dueDay: 3, progress: 0 },
  { id: "po-1010", number: "VP-2026-1111", itemCode: "ID 611-088", itemName: "Zostava klipu", quantity: 6800, machineId: "b-01", day: 4, shift: 1, duration: 5, priority: "normal", status: "confirmed", dueDay: 4, progress: 0 },
  { id: "po-1011", number: "VP-2026-1112", itemCode: "ID 230-119", itemName: "Spona sedadla", quantity: 9900, machineId: null, day: null, shift: 1, duration: 7, priority: "high", status: "draft", dueDay: 2, progress: 0 },
  { id: "po-1012", number: "VP-2026-1113", itemCode: "ID 504-442", itemName: "Pružina uzáveru", quantity: 14200, machineId: null, day: null, shift: 2, duration: 8.5, priority: "normal", status: "draft", dueDay: 4, progress: 0 },
  { id: "po-1013", number: "VP-2026-1114", itemCode: "ID 118-907", itemName: "Aretačný prvok", quantity: 5200, machineId: null, day: null, shift: 1, duration: 5.5, priority: "low", status: "draft", dueDay: 4, progress: 0 }
];

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

function buildWeek(offset) {
  const monday = addDays(startOfWorkWeek(new Date()), offset * 7);
  return Array.from({ length: DAY_COUNT }, (_, index) => addDays(monday, index));
}

function sameCalendarDay(left, right) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}

function getShift(shift) {
  return SHIFTS.find((row) => row.value === Number(shift)) || SHIFTS[0];
}

function getLoadTone(value) {
  if (value >= 90) return "critical";
  if (value >= 72) return "warning";
  return "healthy";
}

function canMachineProduceOrder(machine, order) {
  return Boolean(order?.productId && machine?.productIds?.includes(order.productId));
}

function PlanningOrderCard({ order, compact = false, isDragging = false, justMoved = false, onOpen, onMoveSelect, onDragStart, onDragEnd }) {
  const shift = getShift(order.shift);
  return (
    <div
      draggable
      className={`scherdel-plan-order ${order.status} priority-${order.priority} ${compact ? "compact" : ""} ${isDragging ? "is-dragging" : ""} ${justMoved ? "just-moved" : ""}`}
      onDragStart={(event) => onDragStart(event, order.id)}
      onDragEnd={onDragEnd}
    >
      <button type="button" draggable className="drag-handle" aria-pressed={isDragging} title={isDragging ? "Zrušiť presun" : "Vybrať na presun"} onClick={(event) => { event.stopPropagation(); onMoveSelect(order.id); }} onDragStart={(event) => { event.stopPropagation(); onDragStart(event, order.id); }} onDragEnd={onDragEnd}><GripVertical size={15} aria-hidden="true" /></button>
      <button type="button" className="order-open" onClick={(event) => { event.stopPropagation(); onOpen(order.id); }} aria-label={`${order.number}, ${order.itemName}`}>
        <span className="order-copy"><strong>{order.number}</strong><small>{order.itemCode} · {order.itemName}</small></span>
        {!compact ? <span className="order-meta"><b>{shift.label}</b><small>{order.duration} h · {numberFormatter.format(order.quantity)} ks</small></span> : null}
      </button>
      {order.status === "risk" ? <AlertTriangle className="risk-icon" size={15} aria-label="Riziková zákazka" /> : null}
      {order.status === "running" ? <span className="running-progress" style={{ "--progress": `${order.progress}%` }}>{order.progress}%</span> : null}
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
  const [orders, setOrders] = useState(() => INITIAL_ORDERS.map((order) => hydrateOrderTiming({
    ...order,
    productId: SCHERDEL_PRODUCT_CATALOG.find((product) => product.itemCode === order.itemCode)?.id || null
  }, INITIAL_MACHINES)));
  const [weekOffset, setWeekOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [draggedOrderId, setDraggedOrderId] = useState(null);
  const [recentlyMovedOrderId, setRecentlyMovedOrderId] = useState(null);
  const [machineOrdersInitialMachineId, setMachineOrdersInitialMachineId] = useState(null);
  const [machineOrdersInitialDay, setMachineOrdersInitialDay] = useState(null);
  const moveAnimationTimerRef = useRef(null);
  const week = useMemo(() => buildWeek(weekOffset), [weekOffset]);
  const activeMachines = useMemo(() => machines.filter((machine) => machine.active), [machines]);
  const workplaceById = useMemo(() => new Map(workplaces.map((workplace) => [workplace.id, workplace])), [workplaces]);
  const calculatedOrders = useMemo(() => orders.map((order) => {
    const machine = machines.find((item) => item.id === order.machineId);
    const metrics = calculateOrderMetrics(order, machine);
    return { ...order, duration: Number(metrics.totalHours.toFixed(1)), metrics };
  }), [machines, orders]);

  const visibleOrders = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("sk-SK");
    return calculatedOrders.filter((order) => {
      const matchesSearch = !query || `${order.number} ${order.itemCode} ${order.itemName}`.toLocaleLowerCase("sk-SK").includes(query);
      const matchesFilter = filter === "all" || (filter === "risk" ? order.status === "risk" : order.priority === filter);
      return matchesSearch && matchesFilter;
    });
  }, [calculatedOrders, filter, search]);

  const selectedOrder = calculatedOrders.find((order) => order.id === selectedOrderId) || null;
  const draggedOrder = calculatedOrders.find((order) => order.id === draggedOrderId) || null;
  const selectedOrderMachines = selectedOrder?.productId
    ? activeMachines.filter((machine) => machine.id === selectedOrder.machineId || machine.productIds?.includes(selectedOrder.productId))
    : activeMachines;
  const backlog = visibleOrders.filter((order) => !order.machineId);
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

  useEffect(() => () => window.clearTimeout(moveAnimationTimerRef.current), []);

  const updateOrder = (orderId, patch) => {
    setOrders((current) => current.map((order) => order.id === orderId ? { ...order, ...patch } : order));
  };

  const deleteSelectedOrder = () => {
    if (!selectedOrder || !window.confirm(`Naozaj chceš vymazať zákazku ${selectedOrder.number}?`)) return;
    setOrders((current) => current.filter((order) => order.id !== selectedOrder.id));
    setSelectedOrderId(null);
  };

  const handleDragStart = (event, orderId) => {
    setDraggedOrderId(orderId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", orderId);
  };

  const moveOrderToCell = (orderId, machineId, day) => {
    const order = orders.find((item) => item.id === orderId);
    const machine = machines.find((item) => item.id === machineId);
    if (!canMachineProduceOrder(machine, order)) return;
    updateOrder(orderId, { machineId, day, status: "draft" });
    window.clearTimeout(moveAnimationTimerRef.current);
    setRecentlyMovedOrderId(orderId);
    moveAnimationTimerRef.current = window.setTimeout(() => setRecentlyMovedOrderId(null), 700);
    setDraggedOrderId(null);
  };

  const handleDrop = (event, machineId, day) => {
    event.preventDefault();
    moveOrderToCell(event.dataTransfer.getData("text/plain") || draggedOrderId, machineId, day);
  };

  return (
    <section className="scherdel-planning" aria-label="Testovací modul plánovania výroby">
      <div className="scherdel-planning-demo-banner">
        <span><Sparkles size={15} />DEMO REŽIM</span>
        <p>Zmeny sú iba lokálne v tomto prehliadači. Modul nič nezapisuje do produkčnej databázy.</p>
      </div>

      <header className="scherdel-planning-header">
        <div>
          <span className="planning-kicker">Production planning · prototyp</span>
          <h2>{activeModule === "plan" ? "Plánovanie výroby" : activeModule === "resources" ? "Stroje a pracoviská" : "Výrobné zákazky"}</h2>
          <p>{activeModule === "plan" ? "Kapacitný plán zákaziek podľa strojov, dní a pracovných zmien." : activeModule === "resources" ? "Konfigurácia výrobných zdrojov a dostupnej kapacity plánu." : "Množstvá, výrobné cykly a automatický výpočet času pre každý stroj."}</p>
        </div>
        {activeModule === "plan" ? <button type="button" className="scherdel-plan-primary" onClick={() => { setMachineOrdersInitialMachineId(null); setMachineOrdersInitialDay(null); setActiveModule("machineOrders"); }}><Plus size={17} />Nová zákazka</button> : null}
      </header>

      <nav className="scherdel-planning-tabs" aria-label="Sekcie plánovania výroby">
        <button type="button" className={activeModule === "plan" ? "active" : ""} onClick={() => setActiveModule("plan")}><CalendarDays size={16} /><span><b>Výrobný plán</b><small>Zákazky a kapacity</small></span></button>
        <button type="button" className={activeModule === "machineOrders" ? "active" : ""} onClick={() => setActiveModule("machineOrders")}><ClipboardList size={16} /><span><b>Výrobné zákazky</b><small>Kusy, cyklus a čas</small></span></button>
        <button type="button" className={activeModule === "resources" ? "active" : ""} onClick={() => setActiveModule("resources")}><Settings2 size={16} /><span><b>Stroje a pracoviská</b><small>Konfigurácia zdrojov</small></span></button>
      </nav>

      {activeModule === "plan" ? <>
      <div className="scherdel-plan-kpis">
        <article><span className="icon blue"><CalendarDays /></span><div><small>Naplánované zákazky</small><strong>{scheduledAll.length}</strong><p>v aktuálnom demo pláne</p></div></article>
        <article><span className="icon green"><Gauge /></span><div><small>Celkové vyťaženie</small><strong>{overallLoad} %</strong><p>{plannedHours} z {totalCapacity} dostupných hodín</p></div></article>
        <article className={riskCount ? "attention" : ""}><span className="icon orange"><AlertTriangle /></span><div><small>Rizikové zákazky</small><strong>{riskCount}</strong><p>vyžadujú zásah plánovača</p></div></article>
        <article><span className="icon violet"><Layers3 /></span><div><small>Nenaplánované</small><strong>{calculatedOrders.filter((order) => !order.machineId).length}</strong><p>čakajú na stroj a termín</p></div></article>
      </div>

      <div className="scherdel-planning-toolbar">
        <div className="week-switcher">
          <button type="button" onClick={() => setWeekOffset((value) => value - 1)} aria-label="Predchádzajúci týždeň"><ArrowLeft size={17} /></button>
          <button type="button" className="current-week" onClick={() => setWeekOffset(0)}><CalendarDays size={16} /><span>{longDateFormatter.format(week[0])} – {longDateFormatter.format(week[4])}</span></button>
          <button type="button" onClick={() => setWeekOffset((value) => value + 1)} aria-label="Nasledujúci týždeň"><ArrowRight size={17} /></button>
          {weekOffset !== 0 ? <button type="button" className="today" onClick={() => setWeekOffset(0)}>Aktuálny týždeň</button> : null}
        </div>
        <label className="planning-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Hľadať zákazku alebo výrobok" /></label>
        <div className="planning-filters" role="group" aria-label="Filtrovanie plánu">
          {[['all', 'Všetko'], ['high', 'Vysoká priorita'], ['risk', 'Riziko']].map(([key, label]) => <button type="button" key={key} className={filter === key ? "active" : ""} onClick={() => setFilter(key)}>{label}</button>)}
        </div>
      </div>

      <div className="scherdel-planning-layout">
        <aside className="scherdel-plan-backlog">
          <div className="backlog-head"><div><PackagePlus size={18} /><span><strong>Backlog</strong><small>Nenaplánované zákazky</small></span></div><b>{backlog.length}</b></div>
          <p>Potiahni zákazku na konkrétny stroj a deň.</p>
          <div className="backlog-list">
            {backlog.map((order) => <PlanningOrderCard key={order.id} order={order} compact isDragging={order.id === draggedOrderId} justMoved={order.id === recentlyMovedOrderId} onOpen={setSelectedOrderId} onMoveSelect={(orderId) => setDraggedOrderId((current) => current === orderId ? null : orderId)} onDragStart={handleDragStart} onDragEnd={() => setDraggedOrderId(null)} />)}
            {!backlog.length ? <div className="backlog-empty"><CheckCircle2 size={24} /><strong>Všetko naplánované</strong><span>Vo filtri nie sú voľné zákazky.</span></div> : null}
          </div>
          <div className="backlog-hint"><Sparkles size={15} /><span><b>Ďalší krok</b>Automatický návrh poradia podľa termínu, kapacity a prestavieb.</span></div>
        </aside>

        <div className="scherdel-plan-board-wrap">
          <div className="scherdel-plan-board" style={{ "--day-count": DAY_COUNT }}>
            <div className="board-corner"><Factory size={16} /><span>Stroj / kapacita</span></div>
            {week.map((date, day) => <div className={`board-day ${sameCalendarDay(date, new Date()) ? "today" : ""}`} key={date.toISOString()}><span>{weekdayFormatter.format(date)}</span><strong>{dateFormatter.format(date)}</strong><small>{day === 4 ? "Piatok" : `${SHIFTS.length} zmeny`}</small></div>)}

            {activeMachines.map((machine) => {
              const load = machineLoads.get(machine.id);
              const loadTone = getLoadTone(load.percent);
              const isCompatibleDropTarget = draggedOrder ? canMachineProduceOrder(machine, draggedOrder) : false;
              return <div className="board-row" key={machine.id}>
                <div className={`board-machine ${draggedOrder ? (isCompatibleDropTarget ? "drop-compatible" : "drop-incompatible") : ""}`}>
                  <span className="machine-code">{machine.code}</span>
                  <strong>{machine.name}</strong>
                  <small>{workplaceById.get(machine.workplaceId)?.name || "Nepriradené pracovisko"}</small>
                  <div className={`machine-load ${loadTone}`}><span><i style={{ width: `${Math.min(load.percent, 100)}%` }} /></span><b>{load.percent} %</b></div>
                  {draggedOrder ? <span className={`drop-machine-status ${isCompatibleDropTarget ? "allowed" : "blocked"}`} title={isCompatibleDropTarget ? `${machine.name} môže vyrábať ${draggedOrder.itemCode}` : `${machine.name} nevyrába ${draggedOrder.itemCode}`}>{isCompatibleDropTarget ? <CheckCircle2 size={11} /> : <Ban size={11} />}{isCompatibleDropTarget ? "Povolené" : "Blokované"}</span> : null}
                </div>
                {week.map((date, day) => {
                  const cellOrders = scheduled.filter((order) => order.machineId === machine.id && order.day === day);
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
                    <button type="button" className="cell-add" onClick={(event) => { event.stopPropagation(); setMachineOrdersInitialMachineId(machine.id); setMachineOrdersInitialDay(day); setActiveModule("machineOrders"); }} aria-label={`Pridať zákazku na ${machine.name}, ${dateFormatter.format(date)}`}><Plus size={13} /></button>
                    {cellOrders.map((order) => <PlanningOrderCard key={order.id} order={order} isDragging={order.id === draggedOrderId} justMoved={order.id === recentlyMovedOrderId} onOpen={setSelectedOrderId} onMoveSelect={(orderId) => setDraggedOrderId((current) => current === orderId ? null : orderId)} onDragStart={handleDragStart} onDragEnd={() => setDraggedOrderId(null)} />)}
                  </div>;
                })}
              </div>;
            })}
          </div>
        </div>
      </div>

      <div className="scherdel-plan-legend">
        <span><i className="running" />Vo výrobe</span><span><i className="confirmed" />Potvrdené</span><span><i className="draft" />Návrh</span><span><i className="risk" />Riziko termínu</span><small>Tip: zákazky môžeš presúvať medzi bunkami pomocou drag-and-drop.</small>
      </div>

      {selectedOrder ? <div className="scherdel-plan-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedOrderId(null); }}>
        <aside className="scherdel-plan-drawer" aria-label={`Detail zákazky ${selectedOrder.number}`}>
          <header><div><span>Detail výrobnej zákazky</span><h3>{selectedOrder.number}</h3></div><button type="button" onClick={() => setSelectedOrderId(null)} aria-label="Zavrieť detail"><X size={19} /></button></header>
          <div className={`drawer-status ${selectedOrder.status}`}><span>{STATUS_LABELS[selectedOrder.status]}</span><b>{PRIORITY_LABELS[selectedOrder.priority]} priorita</b></div>
          <div className="drawer-product"><small>{selectedOrder.itemCode}</small><strong>{selectedOrder.itemName}</strong><span>{numberFormatter.format(selectedOrder.quantity)} ks · plán {formatHours(selectedOrder.metrics.totalHours)} h · zostáva {formatHours(selectedOrder.metrics.remainingHours)} h</span></div>
          {selectedOrder.status === "risk" ? <div className="drawer-warning"><AlertTriangle size={17} /><span><strong>Riziko nesplnenia termínu</strong>Kapacita stroja alebo plánovaný termín vyžaduje kontrolu.</span></div> : null}
          <div className="drawer-form">
            <label><span>Priradený stroj</span><select value={selectedOrder.machineId || ""} onChange={(event) => updateOrder(selectedOrder.id, { machineId: event.target.value || null, day: event.target.value ? (selectedOrder.day ?? 0) : null })}><option value="">Nenaplánované</option>{selectedOrderMachines.map((machine) => <option key={machine.id} value={machine.id}>{machine.code} · {machine.name}</option>)}</select></label>
            <label><span>Plánovaný deň</span><select value={selectedOrder.day ?? ""} disabled={!selectedOrder.machineId} onChange={(event) => updateOrder(selectedOrder.id, { day: Number(event.target.value) })}><option value="">Vybrať deň</option>{week.map((date, day) => <option key={date.toISOString()} value={day}>{weekdayFormatter.format(date)} {dateFormatter.format(date)}</option>)}</select></label>
            <label><span>Pracovná zmena</span><select value={selectedOrder.shift} onChange={(event) => updateOrder(selectedOrder.id, { shift: Number(event.target.value) })}>{SHIFTS.map((shift) => <option key={shift.value} value={shift.value}>{shift.label} · {shift.time}</option>)}</select></label>
            <div className="drawer-form-row"><label><span>Plánované kusy</span><input type="number" min="0" step="100" value={selectedOrder.quantity} onChange={(event) => { const quantity = Math.max(0, Number(event.target.value) || 0); updateOrder(selectedOrder.id, { quantity, completedQuantity: Math.min(selectedOrder.metrics.completedQuantity, quantity) }); }} /></label><label><span>Vyrobené kusy</span><input type="number" min="0" max={selectedOrder.quantity} step="100" value={selectedOrder.metrics.completedQuantity} onChange={(event) => updateOrder(selectedOrder.id, { completedQuantity: Math.min(selectedOrder.quantity, Math.max(0, Number(event.target.value) || 0)) })} /></label></div>
            <div className="drawer-form-row"><label><span>Cyklus (sekúnd / kus)</span><input type="number" min="0.01" step="0.01" value={selectedOrder.cycleTimeSec} onChange={(event) => updateOrder(selectedOrder.id, { cycleTimeSec: Math.max(0.01, Number(event.target.value) || 0.01) })} /></label><label><span>Prestavba (min)</span><input type="number" min="0" step="5" value={selectedOrder.setupMinutes} onChange={(event) => updateOrder(selectedOrder.id, { setupMinutes: Math.max(0, Number(event.target.value) || 0) })} /></label></div>
            <div className="drawer-calculation"><span><Clock3 size={15} />Vypočítaný čas</span><strong>{formatHours(selectedOrder.metrics.totalHours)} h</strong><small>Prestavba + (kusy × cyklus ÷ efektivita stroja {selectedOrder.metrics.efficiencyPercent} %)</small></div>
            <div className="drawer-form-row"><label><span>Priorita</span><select value={selectedOrder.priority} onChange={(event) => updateOrder(selectedOrder.id, { priority: event.target.value })}><option value="high">Vysoká</option><option value="normal">Normálna</option><option value="low">Nízka</option></select></label><label><span>Stav plánu</span><select value={selectedOrder.status} onChange={(event) => updateOrder(selectedOrder.id, { status: event.target.value })}><option value="draft">Návrh</option><option value="confirmed">Potvrdené</option><option value="risk">Riziko</option><option value="running">Vo výrobe</option></select></label></div>
          </div>
          <footer><span><Clock3 size={14} />Demo zmeny sa neukladajú</span><div><button type="button" className="drawer-delete" onClick={deleteSelectedOrder}><Trash2 size={15} />Zmazať</button><button type="button" onClick={() => setSelectedOrderId(null)}><CheckCircle2 size={16} />Hotovo</button></div></footer>
        </aside>
      </div> : null}

      </> : activeModule === "resources" ? <ScherdelResourceConfiguration machines={machines} setMachines={setMachines} workplaces={workplaces} setWorkplaces={setWorkplaces} orders={orders} products={SCHERDEL_PRODUCT_CATALOG} /> : <ScherdelMachineOrders machines={machines} workplaces={workplaces} orders={orders} setOrders={setOrders} products={SCHERDEL_PRODUCT_CATALOG} initialMachineId={machineOrdersInitialMachineId} initialDay={machineOrdersInitialDay} />}
    </section>
  );
}
