import { useMemo, useState } from "react";
import {
  Activity, Building2, CheckCircle2, Clock3, Factory, Gauge, Pencil,
  Plus, Power, Save, Settings2, SlidersHorizontal, X
} from "lucide-react";

const numberFormatter = new Intl.NumberFormat("sk-SK", { maximumFractionDigits: 1 });

function createMachineDraft(machine, workplaces) {
  return machine ? { ...machine, productIds: [...(machine.productIds || [])] } : {
    id: "",
    code: "",
    name: "",
    workplaceId: workplaces[0]?.id || "",
    shiftCount: 3,
    hoursPerDay: 24,
    targetEfficiency: 85,
    productIds: [],
    active: true
  };
}

function createWorkplaceDraft(workplace) {
  return workplace ? { ...workplace } : { id: "", name: "", area: "Hala A", supervisor: "", active: true };
}

export default function ScherdelResourceConfiguration({ machines, setMachines, workplaces, setWorkplaces, orders, products }) {
  const [workplaceFilter, setWorkplaceFilter] = useState("all");
  const [editor, setEditor] = useState(null);
  const [message, setMessage] = useState("");

  const activeMachines = machines.filter((machine) => machine.active);
  const filteredMachines = workplaceFilter === "all" ? machines : machines.filter((machine) => machine.workplaceId === workplaceFilter);
  const scheduledMachineIds = useMemo(() => new Set(orders.filter((order) => order.machineId).map((order) => order.machineId)), [orders]);
  const totalDailyCapacity = activeMachines.reduce((sum, machine) => sum + Number(machine.hoursPerDay || 0), 0);
  const averageEfficiency = activeMachines.length
    ? Math.round(activeMachines.reduce((sum, machine) => sum + Number(machine.targetEfficiency || 0), 0) / activeMachines.length)
    : 0;

  const openMachineEditor = (machine = null) => setEditor({ type: "machine", draft: createMachineDraft(machine, workplaces), isNew: !machine });
  const openWorkplaceEditor = (workplace = null) => setEditor({ type: "workplace", draft: createWorkplaceDraft(workplace), isNew: !workplace });
  const updateDraft = (patch) => setEditor((current) => ({ ...current, draft: { ...current.draft, ...patch } }));

  const saveEditor = () => {
    if (editor.type === "machine") {
      const draft = editor.draft;
      if (!draft.code.trim() || !draft.name.trim() || !draft.workplaceId) return;
      if (editor.isNew) {
        setMachines((current) => [...current, { ...draft, id: `machine-${Date.now()}`, code: draft.code.trim().toUpperCase(), name: draft.name.trim() }]);
      } else {
        setMachines((current) => current.map((machine) => machine.id === draft.id ? { ...draft, code: draft.code.trim().toUpperCase(), name: draft.name.trim() } : machine));
      }
      setMessage(editor.isNew ? "Testovací stroj bol pridaný do plánu." : "Konfigurácia stroja bola upravená.");
    } else {
      const draft = editor.draft;
      if (!draft.name.trim()) return;
      if (editor.isNew) {
        const id = `workplace-${Date.now()}`;
        setWorkplaces((current) => [...current, { ...draft, id, name: draft.name.trim() }]);
        setWorkplaceFilter(id);
      } else {
        setWorkplaces((current) => current.map((workplace) => workplace.id === draft.id ? { ...draft, name: draft.name.trim() } : workplace));
      }
      setMessage(editor.isNew ? "Testovacie pracovisko bolo vytvorené." : "Pracovisko bolo upravené.");
    }
    setEditor(null);
  };

  const toggleMachine = (machineId) => {
    setMachines((current) => current.map((machine) => machine.id === machineId ? { ...machine, active: !machine.active } : machine));
    setMessage("Dostupnosť stroja bola zmenená iba v demo konfigurácii.");
  };

  return (
    <div className="resource-config">
      {message ? <div className="resource-config-message"><CheckCircle2 size={16} />{message}<button type="button" onClick={() => setMessage("")}><X size={14} /></button></div> : null}

      <div className="resource-config-kpis">
        <article><span className="blue"><Factory /></span><div><small>Stroje</small><strong>{activeMachines.length} / {machines.length}</strong><p>aktívne v plánovaní</p></div></article>
        <article><span className="violet"><Building2 /></span><div><small>Pracoviská</small><strong>{workplaces.length}</strong><p>výrobné a logistické úseky</p></div></article>
        <article><span className="green"><Clock3 /></span><div><small>Denná kapacita</small><strong>{numberFormatter.format(totalDailyCapacity)} h</strong><p>súčet aktívnych strojov</p></div></article>
        <article><span className="orange"><Gauge /></span><div><small>Cieľová efektivita</small><strong>{averageEfficiency} %</strong><p>priemer aktívnych strojov</p></div></article>
      </div>

      <div className="resource-config-actions">
        <div><span>Kapacitný model</span><h3>Stroje a pracoviská</h3><p>Nastavenia použité pri výpočte dostupnej kapacity výrobného plánu.</p></div>
        <div><button type="button" className="secondary" onClick={() => openWorkplaceEditor()}><Building2 size={16} />Nové pracovisko</button><button type="button" className="primary" onClick={() => openMachineEditor()}><Plus size={16} />Pridať stroj</button></div>
      </div>

      <div className="resource-config-layout">
        <aside className="resource-workplaces">
          <header><Building2 size={17} /><div><strong>Pracoviská</strong><small>Filtrovanie strojov</small></div></header>
          <button type="button" className={workplaceFilter === "all" ? "active" : ""} onClick={() => setWorkplaceFilter("all")}><span><b>Všetky pracoviská</b><small>Kompletná konfigurácia</small></span><em>{machines.length}</em></button>
          {workplaces.map((workplace) => {
            const rows = machines.filter((machine) => machine.workplaceId === workplace.id);
            const activeCount = rows.filter((machine) => machine.active).length;
            return <button type="button" className={workplaceFilter === workplace.id ? "active" : ""} key={workplace.id} onClick={() => setWorkplaceFilter(workplace.id)}><span><b>{workplace.name}</b><small>{workplace.area} · {activeCount} aktívne</small></span><em>{rows.length}</em><i onClick={(event) => { event.stopPropagation(); openWorkplaceEditor(workplace); }} role="button" tabIndex="0" aria-label={`Upraviť pracovisko ${workplace.name}`}><Pencil size={12} /></i></button>;
          })}
        </aside>

        <section className="resource-machines">
          <header><div><SlidersHorizontal size={17} /><span><strong>Konfigurácia strojov</strong><small>{filteredMachines.length} záznamov v aktuálnom filtri</small></span></div><span className="resource-demo-pill">LOKÁLNE DEMO</span></header>
          <div className="resource-table-wrap">
            <table>
              <thead><tr><th>Stroj</th><th>Pracovisko</th><th>Sortiment</th><th>Zmeny</th><th>Kapacita / deň</th><th>Cieľ</th><th>Plán</th><th>Stav</th><th /></tr></thead>
              <tbody>{filteredMachines.map((machine) => {
                const workplace = workplaces.find((row) => row.id === machine.workplaceId);
                return <tr className={!machine.active ? "inactive" : ""} key={machine.id}>
                  <td><span className="resource-machine-name"><i>{machine.code}</i><span><b>{machine.name}</b><small>{machine.id}</small></span></span></td>
                  <td><b>{workplace?.name || "Nepriradené"}</b><small>{workplace?.area || "–"}</small></td>
                  <td><b>{machine.productIds?.length || 0} výrobkov</b><small>{products.filter((product) => machine.productIds?.includes(product.id)).slice(0, 2).map((product) => product.itemCode).join(", ") || "Nenastavené"}</small></td>
                  <td><b>{machine.shiftCount}-zmenná</b><small>{machine.shiftCount * 8} h nominálne</small></td>
                  <td><b>{numberFormatter.format(machine.hoursPerDay)} h</b><small>{numberFormatter.format(machine.hoursPerDay * 5)} h / týždeň</small></td>
                  <td><b>{machine.targetEfficiency} %</b><span className="resource-target"><i style={{ width: `${machine.targetEfficiency}%` }} /></span></td>
                  <td>{scheduledMachineIds.has(machine.id) ? <span className="used"><Activity size={13} />Použitý</span> : <span className="unused">Bez zákazky</span>}</td>
                  <td><button type="button" className={`resource-power ${machine.active ? "active" : ""}`} onClick={() => toggleMachine(machine.id)}><Power size={13} />{machine.active ? "Aktívny" : "Vypnutý"}</button></td>
                  <td><button type="button" className="resource-edit" onClick={() => openMachineEditor(machine)} aria-label={`Upraviť ${machine.name}`}><Settings2 size={15} /></button></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
          {!filteredMachines.length ? <div className="resource-empty"><Factory size={28} /><strong>Žiadne stroje</strong><span>Pridaj prvý stroj pre vybrané pracovisko.</span></div> : null}
        </section>
      </div>

      {editor ? <div className="resource-editor-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditor(null); }}>
        <aside className="resource-editor">
          <header><span className="editor-icon">{editor.type === "machine" ? <Factory /> : <Building2 />}</span><div><small>{editor.isNew ? "NOVÁ KONFIGURÁCIA" : "UPRAVIŤ KONFIGURÁCIU"}</small><h3>{editor.type === "machine" ? (editor.isNew ? "Pridať stroj" : editor.draft.name) : (editor.isNew ? "Nové pracovisko" : editor.draft.name)}</h3></div><button type="button" onClick={() => setEditor(null)}><X size={18} /></button></header>
          {editor.type === "machine" ? <div className="resource-editor-form">
            <div className="two"><label><span>Kód stroja</span><input value={editor.draft.code} onChange={(event) => updateDraft({ code: event.target.value })} placeholder="Napr. P-03" /></label><label><span>Názov stroja</span><input value={editor.draft.name} onChange={(event) => updateDraft({ name: event.target.value })} placeholder="Výrobný stroj" /></label></div>
            <label><span>Pracovisko</span><select value={editor.draft.workplaceId} onChange={(event) => updateDraft({ workplaceId: event.target.value })}>{workplaces.map((workplace) => <option key={workplace.id} value={workplace.id}>{workplace.name} · {workplace.area}</option>)}</select></label>
            <div className="two"><label><span>Počet zmien</span><select value={editor.draft.shiftCount} onChange={(event) => { const shiftCount = Number(event.target.value); updateDraft({ shiftCount, hoursPerDay: shiftCount * 8 }); }}><option value="1">1 zmena</option><option value="2">2 zmeny</option><option value="3">3 zmeny</option></select></label><label><span>Kapacita za deň (h)</span><input type="number" min="1" max="24" value={editor.draft.hoursPerDay} onChange={(event) => updateDraft({ hoursPerDay: Math.min(24, Math.max(1, Number(event.target.value) || 1)) })} /></label></div>
            <label><span>Cieľová efektivita (%)</span><input type="number" min="1" max="100" value={editor.draft.targetEfficiency} onChange={(event) => updateDraft({ targetEfficiency: Math.min(100, Math.max(1, Number(event.target.value) || 1)) })} /></label>
            <fieldset className="resource-product-selector">
              <legend><span>Povolený sortiment</span><small>Vyber výrobky, ktoré možno vyrábať na tomto stroji.</small></legend>
              <div>{products.map((product) => {
                const checked = editor.draft.productIds?.includes(product.id) || false;
                return <label key={product.id} className={checked ? "selected" : ""}><input type="checkbox" checked={checked} onChange={(event) => updateDraft({ productIds: event.target.checked ? [...(editor.draft.productIds || []), product.id] : (editor.draft.productIds || []).filter((id) => id !== product.id) })} /><span><b>{product.itemCode}</b><small>{product.itemName}</small></span></label>;
              })}</div>
            </fieldset>
            <label className="resource-checkbox"><input type="checkbox" checked={editor.draft.active} onChange={(event) => updateDraft({ active: event.target.checked })} /><span><b>Aktívny v plánovaní</b><small>Stroj sa zobrazí v kapacitnom pláne a vo výbere zákazky.</small></span></label>
          </div> : <div className="resource-editor-form">
            <label><span>Názov pracoviska</span><input value={editor.draft.name} onChange={(event) => updateDraft({ name: event.target.value })} placeholder="Napr. Lisovňa" /></label>
            <label><span>Výrobná oblasť</span><input value={editor.draft.area} onChange={(event) => updateDraft({ area: event.target.value })} placeholder="Napr. Hala B" /></label>
            <label><span>Zodpovedná osoba</span><input value={editor.draft.supervisor} onChange={(event) => updateDraft({ supervisor: event.target.value })} placeholder="Meno vedúceho (voliteľné)" /></label>
          </div>}
          <footer><span>V demo režime sa zmeny po obnovení stránky zahodia.</span><button type="button" onClick={saveEditor}><Save size={16} />Uložiť konfiguráciu</button></footer>
        </aside>
      </div> : null}
    </div>
  );
}
