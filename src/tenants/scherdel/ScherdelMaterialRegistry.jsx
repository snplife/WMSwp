import { useMemo, useState } from "react";
import { Boxes, Factory, GitBranch, Pencil, Plus, Save, Search, Trash2, X } from "lucide-react";

const numberFormatter = new Intl.NumberFormat("sk-SK");

function createEmptyDraft() {
  return {
    id: "",
    itemCode: "",
    itemName: "",
    operation: "",
    defaultQuantity: 1000,
    cycleTimeSec: 1,
    setupMinutes: 30,
    feedsIntoProductIds: [],
    machineIds: []
  };
}

function normalizeDraft(product, machines) {
  return {
    ...createEmptyDraft(),
    ...product,
    feedsIntoProductIds: [...(product?.feedsIntoProductIds || [])],
    machineIds: machines.filter((machine) => machine.productIds?.includes(product?.id)).map((machine) => machine.id)
  };
}

export default function ScherdelMaterialRegistry({ products, setProducts, machines, setMachines, orders }) {
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState(null);
  const [message, setMessage] = useState("");
  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const visibleProducts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("sk-SK");
    if (!query) return products;
    return products.filter((product) => `${product.itemCode} ${product.itemName} ${product.operation}`.toLocaleLowerCase("sk-SK").includes(query));
  }, [products, search]);
  const chainedCount = products.filter((product) => product.feedsIntoProductIds?.length).length;

  const updateDraft = (patch) => setEditor((current) => ({ ...current, ...patch }));
  const toggleArrayValue = (key, value) => setEditor((current) => ({
    ...current,
    [key]: current[key].includes(value) ? current[key].filter((item) => item !== value) : [...current[key], value]
  }));

  const saveMaterial = (event) => {
    event.preventDefault();
    const itemCode = String(editor?.itemCode || "").trim();
    const itemName = String(editor?.itemName || "").trim();
    if (!itemCode || !itemName) {
      setMessage("Kód a názov materiálu sú povinné.");
      return;
    }
    const duplicate = products.find((product) => product.id !== editor.id && product.itemCode.toLocaleLowerCase("sk-SK") === itemCode.toLocaleLowerCase("sk-SK"));
    if (duplicate) {
      setMessage(`Materiál ${itemCode} už existuje.`);
      return;
    }

    const id = editor.id || `material-${Date.now()}`;
    const nextProduct = {
      id,
      itemCode,
      itemName,
      operation: String(editor.operation || "").trim() || "Výrobná operácia",
      defaultQuantity: Math.max(1, Number(editor.defaultQuantity) || 1),
      cycleTimeSec: Math.max(0.01, Number(editor.cycleTimeSec) || 0.01),
      setupMinutes: Math.max(0, Number(editor.setupMinutes) || 0),
      feedsIntoProductIds: editor.feedsIntoProductIds.filter((productId) => productId !== id)
    };
    setProducts((current) => editor.id
      ? current.map((product) => product.id === id ? nextProduct : product)
      : [...current, nextProduct]);
    setMachines((current) => current.map((machine) => ({
      ...machine,
      productIds: editor.machineIds.includes(machine.id)
        ? Array.from(new Set([...(machine.productIds || []), id]))
        : (machine.productIds || []).filter((productId) => productId !== id)
    })));
    setMessage(editor.id ? "Materiál a jeho nadväznosť boli upravené." : "Nový materiál bol zaregistrovaný.");
    setEditor(null);
  };

  const deleteMaterial = (product) => {
    if (orders.some((order) => order.productId === product.id)) {
      setMessage(`Materiál ${product.itemCode} používa výrobná zákazka, preto ho nemožno zmazať.`);
      return;
    }
    if (!window.confirm(`Vymazať materiál ${product.itemCode}?`)) return;
    setProducts((current) => current
      .filter((item) => item.id !== product.id)
      .map((item) => ({ ...item, feedsIntoProductIds: (item.feedsIntoProductIds || []).filter((id) => id !== product.id) })));
    setMachines((current) => current.map((machine) => ({ ...machine, productIds: (machine.productIds || []).filter((id) => id !== product.id) })));
    setMessage("Materiál bol odstránený.");
  };

  return (
    <div className="material-registry">
      <div className="material-registry-kpis">
        <article><span className="blue"><Boxes /></span><div><small>Registrované materiály</small><strong>{products.length}</strong><p>polotovary a finálne diely</p></div></article>
        <article><span className="violet"><GitBranch /></span><div><small>Reťazené materiály</small><strong>{chainedCount}</strong><p>vstupujú do ďalšej výroby</p></div></article>
        <article><span className="green"><Factory /></span><div><small>Výrobné zdroje</small><strong>{machines.filter((machine) => machine.active).length}</strong><p>aktívne stroje v plánovaní</p></div></article>
      </div>

      <section className="material-registry-panel">
        <header>
          <div><span className="planning-kicker">Materiálový katalóg</span><h3>Materiály a výrobné nadväznosti</h3><p>Registruj polotovar, operáciu, vhodné stroje a do ktorého materiálu ďalej vstupuje.</p></div>
          <button type="button" className="scherdel-plan-primary" onClick={() => { setMessage(""); setEditor(createEmptyDraft()); }}><Plus size={16} />Nový materiál</button>
        </header>
        <div className="material-registry-tools">
          <label><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Hľadať kód, názov alebo operáciu" /></label>
          {message ? <span role="status">{message}</span> : null}
        </div>
        <div className="material-registry-table-wrap">
          <table>
            <thead><tr><th>Materiál</th><th>Operácia</th><th>Predvolené množstvo</th><th>Výrobný čas</th><th>Vyrába sa na</th><th>Vstupuje do</th><th /></tr></thead>
            <tbody>{visibleProducts.map((product) => {
              const productMachines = machines.filter((machine) => machine.productIds?.includes(product.id));
              const targets = (product.feedsIntoProductIds || []).map((id) => productById.get(id)).filter(Boolean);
              return <tr key={product.id}>
                <td><b>{product.itemCode}</b><small>{product.itemName}</small></td>
                <td><span className="material-operation">{product.operation || "Výrobná operácia"}</span></td>
                <td>{numberFormatter.format(product.defaultQuantity)} ks</td>
                <td>{product.cycleTimeSec} s/ks<small>prestavba {product.setupMinutes} min</small></td>
                <td><div className="material-chip-list">{productMachines.map((machine) => <span key={machine.id}>{machine.code}</span>)}{!productMachines.length ? <em>bez stroja</em> : null}</div></td>
                <td><div className="material-chain-targets">{targets.map((target) => <span key={target.id}><GitBranch size={11} />{target.itemCode}<small>{target.operation}</small></span>)}{!targets.length ? <em>Finálny materiál</em> : null}</div></td>
                <td><div className="material-row-actions"><button type="button" onClick={() => { setMessage(""); setEditor(normalizeDraft(product, machines)); }} aria-label={`Upraviť ${product.itemCode}`}><Pencil size={14} /></button><button type="button" className="danger" onClick={() => deleteMaterial(product)} aria-label={`Vymazať ${product.itemCode}`}><Trash2 size={14} /></button></div></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      </section>

      {editor ? <div className="scherdel-plan-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditor(null); }}>
        <form className="scherdel-plan-modal material-editor" onSubmit={saveMaterial}>
          <header><span className="modal-icon"><Boxes /></span><div><small>MATERIÁLOVÝ REGISTER</small><h3>{editor.id ? "Upraviť materiál" : "Registrovať nový materiál"}</h3></div><button type="button" onClick={() => setEditor(null)} aria-label="Zavrieť"><X size={18} /></button></header>
          <div className="material-editor-grid">
            <label><span>Kód materiálu</span><input value={editor.itemCode} onChange={(event) => updateDraft({ itemCode: event.target.value })} placeholder="napr. POLOTOVAR-042" required /></label>
            <label><span>Názov materiálu</span><input value={editor.itemName} onChange={(event) => updateDraft({ itemName: event.target.value })} placeholder="Ohýbaný polotovar" required /></label>
            <label className="wide"><span>Výrobná operácia</span><input value={editor.operation} onChange={(event) => updateDraft({ operation: event.target.value })} placeholder="Ohýbanie, zváranie, kontrola…" /></label>
            <label><span>Predvolené množstvo</span><input type="number" min="1" value={editor.defaultQuantity} onChange={(event) => updateDraft({ defaultQuantity: event.target.value })} /></label>
            <label><span>Cyklus s/ks</span><input type="number" min="0.01" step="0.01" value={editor.cycleTimeSec} onChange={(event) => updateDraft({ cycleTimeSec: event.target.value })} /></label>
            <label><span>Prestavba min</span><input type="number" min="0" step="5" value={editor.setupMinutes} onChange={(event) => updateDraft({ setupMinutes: event.target.value })} /></label>
          </div>
          <fieldset className="material-editor-options"><legend>Vyrába sa na strojoch</legend><div>{machines.map((machine) => <label key={machine.id} className={editor.machineIds.includes(machine.id) ? "selected" : ""}><input type="checkbox" checked={editor.machineIds.includes(machine.id)} onChange={() => toggleArrayValue("machineIds", machine.id)} /><span><b>{machine.code}</b><small>{machine.name}</small></span></label>)}</div></fieldset>
          <fieldset className="material-editor-options"><legend>Do čoho tento materiál vstupuje</legend><p>Označ nasledujúce polotovary alebo finálne diely. Plán z toho vytvorí materiálovú reťaz.</p><div>{products.filter((product) => product.id !== editor.id).map((product) => <label key={product.id} className={editor.feedsIntoProductIds.includes(product.id) ? "selected" : ""}><input type="checkbox" checked={editor.feedsIntoProductIds.includes(product.id)} onChange={() => toggleArrayValue("feedsIntoProductIds", product.id)} /><span><b>{product.itemCode}</b><small>{product.itemName}</small></span></label>)}</div></fieldset>
          <footer><button type="button" className="secondary" onClick={() => setEditor(null)}>Zrušiť</button><button type="submit" className="primary"><Save size={15} />Uložiť materiál</button></footer>
        </form>
      </div> : null}
    </div>
  );
}
