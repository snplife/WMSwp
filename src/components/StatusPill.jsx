function StatusPill({ status }) {
  const normalized = (status || "unknown").toLowerCase();
  const statusLabels = {
    receive: "príjem",
    recieve: "príjem",
    issue: "výdaj",
    move: "presun",
    move_all: "presun",
    unknown: "neznáme"
  };
  const label = statusLabels[normalized] || normalized;

  return <span className={`pill pill-${normalized}`}>{label}</span>;
}

export default StatusPill;
