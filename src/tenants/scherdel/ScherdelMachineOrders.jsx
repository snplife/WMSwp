import { useMemo, useState } from "react";
import { Activity, Boxes, Clock3, Factory, Gauge, PackagePlus, Plus, Search, Trash2, X } from "lucide-react";
import { calculateOrderMetrics, formatHours } from "./productionPlanningCalculations";

const numberFormatter = new Intl.NumberFormat("sk-SK");
const STATUS_LABELS = { confirmed: "Potvrdené", draft: "Návrh", risk: "Riziko", running: "Vo výrobe" };

export default function ScherdelMachineOrders({ orders, setOrders, machines, workplaces, products, initialMachineId, initialDay }) {
  const activeMachines = useMemo(() => machines.filter((machine) => machine.active), [machines]);
  const [selectedMachineId, setSelectedMachineId] = useState(() => initialMachineId || activeMachines[0]?.id || "");
  const [search, setSearch] = useState("");
  const [showProductPicker, setShowProductPicker] = useState(false);
  const selectedMachine = activeMachines.find((machine) => machine.id === selectedMachineId) || activeMachines[0];
  const workplace = workplaces.find((item) => item.id === selectedMachine?.workplaceId);
  const eligibleProducts = useMemo(() => products.filter((product) => selectedMachine?.productIds?.includes(product.id)), [products, selectedMachine]);
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
    hours: sum.hours + row.metrics.totalHours
  }), { quantity: 0, hours: 0 }), [rows]);

  const updateOrder = (orderId, patch) => {
    setOrders((current) => current.map((order) => order.id === orderId ? { ...order, ...patch } : order));
  };

  const deleteOrder = (order) => {
    if (!window.confirm(`Naozaj chceš vymazať zákazku ${order.number}?`)) return;
    setOrders((current) => current.filter((item) => item.id !== order.id));
  };

  const addOrder = (product) => {
    if (!selectedMachine || !selectedMachine.productIds?.includes(product.id)) return;
    const id = `po-machine-${Date.now()}`;
    setOrders((current) => [...current, {
      id,
      number: `VP-DEMO-${current.length + 1}`,
      productId: product.id,
      itemCode: product.itemCode,
      itemName: product.itemName,
      quantity: product.defaultQuantity,
      completedQuantity: 0,
      cycleTimeSec: product.cycleTimeSec,
      setupMinutes: product.setupMinutes,
      machineId: selectedMachine.id,
      day: Number.isInteger(initialDay) ? initialDay : 0,
      shift: 1,
      priority: "normal",
      status: "draft",
      dueDay: Number.isInteger(initialDay) ? initialDay : 4,
      progress: 0
    }]);
    setShowProductPicker(false);
  };

  if (!selectedMachine) return <div className="machine-orders-empty"><Factory /><strong>Najprv pridaj aktívny stroj</strong><span>Stroje sa nastavujú v sekcii Stroje a pracoviská.</span></div>;

  return (
    <div className="machine-orders">
      <div className="machine-orders-kpis">
        <article><span className="blue"><PackagePlus /></span><div><small>Výrobné zákazky</small><strong>{rows.length}</strong><p>na zvolenom stroji</p></div></article>
        <article><span className="green"><Factory /></span><div><small>Plánované množstvo</small><strong>{numberFormatter.format(totals.quantity)}</strong><p>kusov spolu</p></div></article>
        <article><span className="violet"><Clock3 /></span><div><small>Celkový plán</small><strong>{formatHours(totals.hours)} h</strong><p>vrátane prestavieb</p></div></article>
        <article><span className="orange"><Gauge /></span><div><small>Denná kapacita</small><strong>{selectedMachine.hoursPerDay} h</strong><p>{selectedMachine.shiftCount} pracovné zmeny</p></div></article>
      </div>

      <div className="machine-orders-layout">
        <aside className="machine-orders-machines">
          <header><Factory size={17} /><span><strong>Stroje</strong><small>Vyber výrobný zdroj</small></span></header>
          {activeMachines.map((machine) => {
            const count = orders.filter((order) => order.machineId === machine.id).length;
            return <button type="button" key={machine.id} className={machine.id === selectedMachine.id ? "active" : ""} onClick={() => { setSelectedMachineId(machine.id); setShowProductPicker(false); }}><i>{machine.code}</i><span><b>{machine.name}</b><small>{workplaces.find((item) => item.id === machine.workplaceId)?.name || "Bez pracoviska"}</small></span><em>{count}</em></button>;
          })}
        </aside>

        <section className="machine-orders-panel">
          <header>
            <div><span className="machine-code">{selectedMachine.code}</span><h3>{selectedMachine.name}</h3><p>{workplace?.name || "Bez pracoviska"} · cieľová efektivita {selectedMachine.targetEfficiency} %</p></div>
            <button type="button" onClick={() => setShowProductPicker(true)}><Plus size={16} />Pridať zákazku</button>
          </header>
          <div className="machine-products-strip">
            <span><Boxes size={15} /><b>Na stroji možno vyrábať</b><small>{eligibleProducts.length} nakonfigurované výrobky</small></span>
            <div>{eligibleProducts.map((product) => <span key={product.id} title={product.itemName}><b>{product.itemCode}</b>{product.itemName}</span>)}{!eligibleProducts.length ? <em>Sortiment nie je nakonfigurovaný</em> : null}</div>
          </div>
          <div className="machine-orders-tools">
            <label><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Hľadať zákazku alebo výrobok" /></label>
            <span><Activity size={14} /><b>Výpočet:</b> prestavba + (kusy × cyklus ÷ efektivita)</span>
          </div>
          <div className="machine-orders-table-wrap">
            <table>
              <thead><tr><th>Zákazka / výrobok</th><th>Plán ks</th><th>Cyklus s/ks</th><th>Prestavba min</th><th>Celkový čas</th><th>Stav</th><th>Akcia</th></tr></thead>
              <tbody>
                {rows.map(({ order, metrics }) => <tr key={order.id}>
                  <td><b>{order.number}</b><small>{order.itemCode} · {order.itemName}</small></td>
                  <td><input aria-label={`Plánované kusy ${order.number}`} type="number" min="0" step="100" value={order.quantity} onChange={(event) => { const quantity = Math.max(0, Number(event.target.value) || 0); updateOrder(order.id, { quantity, completedQuantity: Math.min(metrics.completedQuantity, quantity) }); }} /></td>
                  <td><input aria-label={`Cyklus ${order.number}`} type="number" min="0.01" step="0.01" value={order.cycleTimeSec} onChange={(event) => updateOrder(order.id, { cycleTimeSec: Math.max(0.01, Number(event.target.value) || 0.01) })} /></td>
                  <td><input aria-label={`Prestavba ${order.number}`} type="number" min="0" step="5" value={order.setupMinutes} onChange={(event) => updateOrder(order.id, { setupMinutes: Math.max(0, Number(event.target.value) || 0) })} /></td>
                  <td><b className="time-total">{formatHours(metrics.totalHours)} h</b><small>{metrics.efficiencyPercent} % efektivita</small></td>
                  <td><select aria-label={`Stav ${order.number}`} value={order.status} onChange={(event) => updateOrder(order.id, { status: event.target.value })}><option value="draft">Návrh</option><option value="confirmed">Potvrdené</option><option value="running">Vo výrobe</option><option value="risk">Riziko</option></select><small className={`status-dot ${order.status}`}>{STATUS_LABELS[order.status]}</small></td>
                  <td><button type="button" className="machine-order-delete" onClick={() => deleteOrder(order)} aria-label={`Vymazať zákazku ${order.number}`} title="Vymazať zákazku"><Trash2 size={15} /></button></td>
                </tr>)}
              </tbody>
            </table>
            {!rows.length ? <div className="machine-orders-empty"><PackagePlus /><strong>Na stroji zatiaľ nie sú zákazky</strong><span>Pridaj prvú testovaciu zákazku.</span></div> : null}
          </div>
        </section>
      </div>

      {showProductPicker ? <div className="scherdel-plan-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowProductPicker(false); }}>
        <div className="scherdel-plan-modal machine-product-picker" role="dialog" aria-modal="true" aria-labelledby="machine-product-picker-title">
          <header><span className="modal-icon"><Boxes /></span><div><small>{selectedMachine.code} · POVOLENÝ SORTIMENT</small><h3 id="machine-product-picker-title">Vybrať výrobok pre zákazku</h3></div><button type="button" onClick={() => setShowProductPicker(false)} aria-label="Zavrieť výber výrobku"><X size={18} /></button></header>
          <p>Na stroji <b>{selectedMachine.name}</b> môžeš vytvoriť zákazku iba z nakonfigurovaného sortimentu.</p>
          <div className="machine-product-picker-list">
            {eligibleProducts.map((product) => <button type="button" key={product.id} onClick={() => addOrder(product)}><span><i>{product.itemCode}</i><b>{product.itemName}</b><small>{numberFormatter.format(product.defaultQuantity)} ks · cyklus {product.cycleTimeSec} s/ks · prestavba {product.setupMinutes} min</small></span><Plus size={17} /></button>)}
            {!eligibleProducts.length ? <div className="machine-product-picker-empty"><Factory /><strong>Na stroji nie je povolený žiadny výrobok</strong><span>Sortiment nastavíš v sekcii Stroje a pracoviská → upraviť stroj.</span></div> : null}
          </div>
          <footer><button type="button" className="secondary" onClick={() => setShowProductPicker(false)}>Zrušiť</button></footer>
        </div>
      </div> : null}
    </div>
  );
}
