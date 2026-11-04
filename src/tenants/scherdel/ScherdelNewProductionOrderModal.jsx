import { useMemo, useState } from "react";
import { CalendarDays, GitBranch, PackagePlus, Sparkles, X } from "lucide-react";

const numberFormatter = new Intl.NumberFormat("sk-SK");

function toDateInputValue(date) {
  const local = new Date(date);
  local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
  return local.toISOString().slice(0, 10);
}

export default function ScherdelNewProductionOrderModal({ products, orders, machines, week, initialMachineId, initialDay, initialShift, onClose, onCreate }) {
  const defaultProduct = products.find((product) => !initialMachineId || machines.find((machine) => machine.id === initialMachineId)?.productIds?.includes(product.id)) || products[0] || null;
  const [draft, setDraft] = useState(() => ({
    number: `VP-DEMO-${String(orders.length + 1).padStart(3, "0")}`,
    productId: defaultProduct?.id || "",
    quantity: defaultProduct?.defaultQuantity || 1000,
    dueDate: toDateInputValue(week[Math.min(4, Number.isInteger(initialDay) ? initialDay + 2 : 4)] || week[4] || new Date()),
    priority: "normal",
    predecessorOrderIds: [],
    processInputProductIds: [],
    machineId: initialMachineId || null,
    day: Number.isInteger(initialDay) ? initialDay : null,
    shift: [1, 2, 3].includes(initialShift) ? initialShift : 1
  }));
  const selectedProduct = products.find((product) => product.id === draft.productId) || null;
  const inputProducts = useMemo(() => products.filter((product) => product.feedsIntoProductIds?.includes(draft.productId)), [draft.productId, products]);
  const downstreamProducts = useMemo(() => (selectedProduct?.feedsIntoProductIds || []).map((id) => products.find((product) => product.id === id)).filter(Boolean), [products, selectedProduct]);
  const predecessorCandidates = useMemo(() => orders.filter((order) => inputProducts.some((product) => product.id === order.productId)), [inputProducts, orders]);
  const inputProductsWithoutOrders = useMemo(() => inputProducts.filter((product) => !predecessorCandidates.some((order) => order.productId === product.id)), [inputProducts, predecessorCandidates]);
  const eligibleMachines = useMemo(() => machines.filter((machine) => machine.active && machine.productIds?.includes(draft.productId)), [draft.productId, machines]);

  const updateDraft = (patch) => setDraft((current) => ({ ...current, ...patch }));
  const handleProductChange = (productId) => {
    const product = products.find((item) => item.id === productId);
    updateDraft({ productId, quantity: product?.defaultQuantity || 1000, predecessorOrderIds: [], machineId: null, day: null });
  };
  const togglePredecessor = (orderId) => updateDraft({
    predecessorOrderIds: draft.predecessorOrderIds.includes(orderId)
      ? draft.predecessorOrderIds.filter((id) => id !== orderId)
      : [...draft.predecessorOrderIds, orderId]
  });
  const toggleInputMaterial = (productId) => updateDraft({
    processInputProductIds: draft.processInputProductIds.includes(productId)
      ? draft.processInputProductIds.filter((id) => id !== productId)
      : [...draft.processInputProductIds, productId]
  });
  const submit = (autoAssign) => {
    if (!selectedProduct || !String(draft.number || "").trim() || !draft.dueDate) return;
    onCreate({ ...draft, number: String(draft.number).trim(), quantity: Math.max(1, Number(draft.quantity) || 1) }, autoAssign);
  };

  return (
    <div className="scherdel-plan-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="scherdel-plan-modal new-production-order-modal" role="dialog" aria-modal="true" aria-labelledby="new-production-order-title">
        <header><span className="modal-icon"><PackagePlus /></span><div><small>VÝROBNÝ PLÁN</small><h3 id="new-production-order-title">Nová výrobná zákazka</h3></div><button type="button" onClick={onClose} aria-label="Zavrieť"><X size={18} /></button></header>
        <div className="new-order-grid">
          <label><span>Číslo zákazky</span><input value={draft.number} onChange={(event) => updateDraft({ number: event.target.value })} required /></label>
          <label><span>Materiál / výrobok</span><select value={draft.productId} onChange={(event) => handleProductChange(event.target.value)}>{products.map((product) => <option key={product.id} value={product.id}>{product.itemCode} · {product.itemName}</option>)}</select></label>
          <label><span>Plánované množstvo</span><input type="number" min="1" step="100" value={draft.quantity} onChange={(event) => updateDraft({ quantity: event.target.value })} /></label>
          <label><span>Due date / termín dokončenia</span><input type="date" value={draft.dueDate} onChange={(event) => updateDraft({ dueDate: event.target.value })} /></label>
          <label><span>Priorita</span><select value={draft.priority} onChange={(event) => updateDraft({ priority: event.target.value })}><option value="high">Vysoká</option><option value="normal">Normálna</option><option value="low">Nízka</option></select></label>
        </div>

        <div className="new-order-capacity"><FactorySummary product={selectedProduct} machines={eligibleMachines} /></div>

        <section className="new-order-chain">
          <header><GitBranch size={16} /><div><b>Materiálové reťazenie</b><span>Vyber hotové alebo plánované zákazky, ktorých výstup vstupuje do tejto výroby.</span></div></header>
          {inputProducts.length ? <div className="new-order-material-flow"><span>Vstupy</span>{inputProducts.map((product) => <b key={product.id}>{product.itemCode}<small>{product.operation}</small></b>)}<i>→</i><strong>{selectedProduct?.itemCode}</strong></div> : <p>Tento materiál nemá v registri definovaný predchádzajúci výrobný materiál.</p>}
          {predecessorCandidates.length ? <div className="new-order-predecessors"><b className="new-order-subheading">Existujúce vstupné zákazky</b>{predecessorCandidates.map((order) => <label key={order.id} className={draft.predecessorOrderIds.includes(order.id) ? "selected" : ""}><input type="checkbox" checked={draft.predecessorOrderIds.includes(order.id)} onChange={() => togglePredecessor(order.id)} /><span><b>{order.number}</b><small>{order.itemCode} · {order.itemName}</small></span></label>)}</div> : null}
          {inputProductsWithoutOrders.length ? <div className="new-order-predecessors"><b className="new-order-subheading">Potvrďte materiály na spracovanie</b>{inputProductsWithoutOrders.map((product) => <label key={product.id} className={draft.processInputProductIds.includes(product.id) ? "selected" : ""}><input type="checkbox" checked={draft.processInputProductIds.includes(product.id)} onChange={() => toggleInputMaterial(product.id)} /><span><b>{product.itemCode} · {product.operation}</b><small>{product.itemName} · po potvrdení sa vytvorí vstupná zákazka a zaradí pred túto výrobu</small></span></label>)}</div> : null}
          {downstreamProducts.length ? <div className="new-order-downstream"><span>Výstup tejto zákazky ďalej vstupuje do:</span>{downstreamProducts.map((product) => <b key={product.id}>{product.itemCode} · {product.itemName}</b>)}</div> : null}
        </section>

        <footer><button type="button" className="secondary" onClick={onClose}>Zrušiť</button><button type="button" className="secondary" onClick={() => submit(false)} disabled={!selectedProduct || !draft.dueDate}><CalendarDays size={15} />Pridať do backlogu</button><button type="button" className="primary" onClick={() => submit(true)} disabled={!selectedProduct || !draft.dueDate || !eligibleMachines.length}><Sparkles size={15} />Vytvoriť a automaticky priradiť</button></footer>
      </div>
    </div>
  );
}

function FactorySummary({ product, machines }) {
  return <><span>{product?.operation || "Výrobná operácia"}</span><b>{machines.length ? `${machines.length} kompatibilné stroje` : "Bez kompatibilného stroja"}</b><small>{product ? `${numberFormatter.format(product.defaultQuantity)} ks · ${product.cycleTimeSec} s/ks · prestavba ${product.setupMinutes} min` : "Vyber materiál"}</small></>;
}
