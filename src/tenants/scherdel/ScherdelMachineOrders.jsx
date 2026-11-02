import { useMemo, useState } from "react";
import { Activity, CheckCircle2, Clock3, Factory, Gauge, PackagePlus, Plus, Search, Trash2 } from "lucide-react";
import { calculateOrderMetrics, formatHours } from "./productionPlanningCalculations";

const numberFormatter = new Intl.NumberFormat("sk-SK");
const STATUS_LABELS = { confirmed: "Potvrdené", draft: "Návrh", risk: "Riziko", running: "Vo výrobe" };

export default function ScherdelMachineOrders({ orders, setOrders, machines, workplaces }) {
  const activeMachines = useMemo(() => machines.filter((machine) => machine.active), [machines]);
  const [selectedMachineId, setSelectedMachineId] = useState(() => activeMachines[0]?.id || "");
  const [search, setSearch] = useState("");
  const selectedMachine = activeMachines.find((machine) => machine.id === selectedMachineId) || activeMachines[0];
  const workplace = workplaces.find((item) => item.id === selectedMachine?.workplaceId);
  const machineOrders = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("sk-SK");
    return orders
      .filter((order) => order.machineId === selectedMachine?.id)
      .filter((order) => !query || `${order.number} ${order.itemCode} ${order.itemName}`.toLocaleLowerCase("sk-SK").includes(query))
      .sort((left, right) => (left.day ?? 99) - (right.day ?? 99) || left.shift - right.shift);
  }, [orders, search, selectedMachine?.id]);
  const rows = useMemo(() => machineOrders.map((order) => ({
    order,
    metrics: calculateOrderMetrics(order, selectedMachine)
  })), [machineOrders, selectedMachine]);
  const totals = useMemo(() => rows.reduce((sum, row) => ({
    quantity: sum.quantity + row.metrics.quantity,
    completed: sum.completed + row.metrics.completedQuantity,
    hours: sum.hours + row.metrics.totalHours,
    remaining: sum.remaining + row.metrics.remainingHours
  }), { quantity: 0, completed: 0, hours: 0, remaining: 0 }), [rows]);

  const updateOrder = (orderId, patch) => {
    setOrders((current) => current.map((order) => order.id === orderId ? { ...order, ...patch } : order));
  };

  const deleteOrder = (order) => {
    if (!window.confirm(`Naozaj chceš vymazať zákazku ${order.number}?`)) return;
    setOrders((current) => current.filter((item) => item.id !== order.id));
  };

  const addOrder = () => {
    if (!selectedMachine) return;
    const id = `po-machine-${Date.now()}`;
    setOrders((current) => [...current, {
      id,
      number: `VP-DEMO-${current.length + 1}`,
      itemCode: "ID DEMO",
      itemName: "Nová zákazka stroja",
      quantity: 5000,
      completedQuantity: 0,
      cycleTimeSec: 1.2,
      setupMinutes: 30,
      machineId: selectedMachine.id,
      day: 0,
      shift: 1,
      priority: "normal",
      status: "draft",
      dueDay: 4,
      progress: 0
    }]);
  };

  if (!selectedMachine) return <div className="machine-orders-empty"><Factory /><strong>Najprv pridaj aktívny stroj</strong><span>Stroje sa nastavujú v sekcii Stroje a pracoviská.</span></div>;

  return (
    <div className="machine-orders">
      <div className="machine-orders-kpis">
        <article><span className="blue"><PackagePlus /></span><div><small>Zákazky na stroji</small><strong>{rows.length}</strong><p>{numberFormatter.format(totals.quantity)} plánovaných ks</p></div></article>
        <article><span className="green"><CheckCircle2 /></span><div><small>Vyrobené</small><strong>{numberFormatter.format(totals.completed)}</strong><p>kusov zo zvolených zákaziek</p></div></article>
        <article><span className="violet"><Clock3 /></span><div><small>Celkový plán</small><strong>{formatHours(totals.hours)} h</strong><p>vrátane prestavieb</p></div></article>
        <article><span className="orange"><Gauge /></span><div><small>Zostávajúci čas</small><strong>{formatHours(totals.remaining)} h</strong><p>podľa vyrobených kusov</p></div></article>
      </div>

      <div className="machine-orders-layout">
        <aside className="machine-orders-machines">
          <header><Factory size={17} /><span><strong>Stroje</strong><small>Vyber výrobný zdroj</small></span></header>
          {activeMachines.map((machine) => {
            const count = orders.filter((order) => order.machineId === machine.id).length;
            return <button type="button" key={machine.id} className={machine.id === selectedMachine.id ? "active" : ""} onClick={() => setSelectedMachineId(machine.id)}><i>{machine.code}</i><span><b>{machine.name}</b><small>{workplaces.find((item) => item.id === machine.workplaceId)?.name || "Bez pracoviska"}</small></span><em>{count}</em></button>;
          })}
        </aside>

        <section className="machine-orders-panel">
          <header>
            <div><span className="machine-code">{selectedMachine.code}</span><h3>{selectedMachine.name}</h3><p>{workplace?.name || "Bez pracoviska"} · cieľová efektivita {selectedMachine.targetEfficiency} %</p></div>
            <button type="button" onClick={addOrder}><Plus size={16} />Pridať zákazku</button>
          </header>
          <div className="machine-orders-tools">
            <label><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Hľadať zákazku alebo výrobok" /></label>
            <span><Activity size={14} /><b>Výpočet:</b> prestavba + (kusy × cyklus ÷ efektivita)</span>
          </div>
          <div className="machine-orders-table-wrap">
            <table>
              <thead><tr><th>Zákazka / výrobok</th><th>Plán ks</th><th>Vyrobené ks</th><th>Cyklus s/ks</th><th>Prestavba min</th><th>Celkový čas</th><th>Zostáva</th><th>Stav</th><th>Akcia</th></tr></thead>
              <tbody>
                {rows.map(({ order, metrics }) => <tr key={order.id}>
                  <td><b>{order.number}</b><small>{order.itemCode} · {order.itemName}</small></td>
                  <td><input aria-label={`Plánované kusy ${order.number}`} type="number" min="0" step="100" value={order.quantity} onChange={(event) => { const quantity = Math.max(0, Number(event.target.value) || 0); updateOrder(order.id, { quantity, completedQuantity: Math.min(metrics.completedQuantity, quantity) }); }} /></td>
                  <td><input aria-label={`Vyrobené kusy ${order.number}`} type="number" min="0" max={order.quantity} step="100" value={metrics.completedQuantity} onChange={(event) => updateOrder(order.id, { completedQuantity: Math.min(order.quantity, Math.max(0, Number(event.target.value) || 0)) })} /></td>
                  <td><input aria-label={`Cyklus ${order.number}`} type="number" min="0.01" step="0.01" value={order.cycleTimeSec} onChange={(event) => updateOrder(order.id, { cycleTimeSec: Math.max(0.01, Number(event.target.value) || 0.01) })} /></td>
                  <td><input aria-label={`Prestavba ${order.number}`} type="number" min="0" step="5" value={order.setupMinutes} onChange={(event) => updateOrder(order.id, { setupMinutes: Math.max(0, Number(event.target.value) || 0) })} /></td>
                  <td><b className="time-total">{formatHours(metrics.totalHours)} h</b><small>{metrics.efficiencyPercent} % efektivita</small></td>
                  <td><b className="time-remaining">{formatHours(metrics.remainingHours)} h</b><small>{numberFormatter.format(metrics.remainingQuantity)} ks</small></td>
                  <td><select aria-label={`Stav ${order.number}`} value={order.status} onChange={(event) => updateOrder(order.id, { status: event.target.value })}><option value="draft">Návrh</option><option value="confirmed">Potvrdené</option><option value="running">Vo výrobe</option><option value="risk">Riziko</option></select><small className={`status-dot ${order.status}`}>{STATUS_LABELS[order.status]}</small></td>
                  <td><button type="button" className="machine-order-delete" onClick={() => deleteOrder(order)} aria-label={`Vymazať zákazku ${order.number}`} title="Vymazať zákazku"><Trash2 size={15} /></button></td>
                </tr>)}
              </tbody>
            </table>
            {!rows.length ? <div className="machine-orders-empty"><PackagePlus /><strong>Na stroji zatiaľ nie sú zákazky</strong><span>Pridaj prvú testovaciu zákazku.</span></div> : null}
          </div>
        </section>
      </div>
    </div>
  );
}
