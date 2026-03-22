function StatusPill({ status }) {
  const normalized = (status || "unknown").toLowerCase();
  const statusLabels = {
    receive: "príjem",
    recieve: "príjem",
    issue: "výdaj",
    move: "presun",
    move_all: "presun",
    draft: "rozpracované",
    sent: "odoslaná",
    accepted: "schválená",
    rejected: "zamietnutá",
    issued: "vystavená",
    paid: "uhradená",
    cancelled: "stornovaná",
    clock_in: "príchod",
    clock_out: "odchod",
    break_start: "pauza štart",
    break_end: "pauza koniec",
    pause: "pauza",
    in: "v práci",
    out: "mimo",
    inactive: "neaktivne",
    lead: "caka na kontakt",
    trialing: "skusobna doba",
    active: "aktivne",
    past_due: "po splatnosti",
    unpaid: "neuhradene",
    incomplete: "caka na platbu",
    incomplete_expired: "checkout expiroval",
    canceled: "zrusene",
    completed: "dokončené",
    unknown: "neznáme"
  };
  const label = statusLabels[normalized] || normalized;

  return <span className={`pill pill-${normalized}`}>{label}</span>;
}

export default StatusPill;
