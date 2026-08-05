import { memo, useMemo, useState } from "react";
import { Activity, BarChart3, Gauge, PackageCheck } from "lucide-react";
import { getMesEventQuantity, summarizeMesStateWindow } from "../../modules/mes/analytics";
import { getMesThroughputRangeWindow } from "../../modules/mes/timeRanges";

const RANGE_OPTIONS = [
  { key: "last_8_hours", label: "Posledných 8 hodín" },
  { key: "current_shift", label: "Aktuálna zmena" },
  { key: "today", label: "Dnes" },
  { key: "last_7_days", label: "Posledných 7 dní" }
];

const formatNumber = (value, digits = 0) => new Intl.NumberFormat("sk-SK", { maximumFractionDigits: digits }).format(Number(value || 0));
const clampPercent = (value) => Math.max(0, Math.min(100, Number(value || 0)));

function matchesMachine(row, selectedRow) {
  const machineId = String(selectedRow?.machine_id || "");
  const workstationId = String(selectedRow?.workstation_id || "");
  const terminalId = String(selectedRow?.terminal_id || "");
  return (
    (machineId && String(row?.machine_id || "") === machineId) ||
    (workstationId && String(row?.workstation_id || "") === workstationId) ||
    (terminalId && String(row?.terminal_id || "") === terminalId) ||
    (selectedRow?.job_run_id && String(row?.job_run_id || row?.id || "") === String(selectedRow.job_run_id))
  );
}

function buildBuckets(rangeWindow) {
  const bucket = rangeWindow.bucket === "day" ? "day" : rangeWindow.bucket === "minute" ? "minute" : "hour";
  const endAt = new Date(rangeWindow.endAt);
  const cursor = new Date(rangeWindow.startAt);
  if (bucket === "day") cursor.setHours(0, 0, 0, 0);
  else if (bucket === "minute") cursor.setSeconds(0, 0);
  else cursor.setMinutes(0, 0, 0);
  const rows = [];
  while (cursor < endAt && rows.length < 96) {
    const startAt = new Date(cursor);
    if (bucket === "day") cursor.setDate(cursor.getDate() + 1);
    else if (bucket === "minute") cursor.setMinutes(cursor.getMinutes() + 1);
    else cursor.setHours(cursor.getHours() + 1);
    const bucketEnd = new Date(Math.min(cursor.getTime(), endAt.getTime()));
    rows.push({
      key: startAt.toISOString(),
      startAt,
      endAt: bucketEnd,
      label: bucket === "day"
        ? startAt.toLocaleDateString("sk-SK", { day: "2-digit", month: "2-digit" })
        : startAt.toLocaleTimeString("sk-SK", { hour: "2-digit", minute: "2-digit" })
    });
  }
  return rows;
}

function makePolyline(rows, valueKey, maximum = 100) {
  if (rows.length < 2) return "";
  const maxValue = Math.max(1, Number(maximum || 0));
  return rows.map((row, index) => {
    const x = (index / (rows.length - 1)) * 100;
    const y = 100 - (Math.max(0, Number(row[valueKey] || 0)) / maxValue) * 100;
    return `${x.toFixed(1)},${Math.max(0, Math.min(100, y)).toFixed(1)}`;
  }).join(" ");
}

const TrendChart = memo(function TrendChart({ rows, valueKey, maximum, tone = "blue", emptyLabel }) {
  const polyline = makePolyline(rows, valueKey, maximum);
  if (!polyline) return <div className="factory-chart-empty">{emptyLabel}</div>;
  return (
    <div className={`factory-line-chart tone-${tone}`}>
      <span className="factory-chart-grid grid-25" /><span className="factory-chart-grid grid-50" /><span className="factory-chart-grid grid-75" />
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img"><polyline points={polyline} fill="none" vectorEffect="non-scaling-stroke" /></svg>
      <div className="factory-chart-labels"><span>{rows[0]?.label}</span><span>{rows[Math.floor(rows.length / 2)]?.label}</span><span>{rows.at(-1)?.label}</span></div>
    </div>
  );
});

const MesCharts = memo(function MesCharts({ selectedRow, selectedRuns, mesEvents }) {
  const [rangeKey, setRangeKey] = useState("last_8_hours");
  const chartData = useMemo(() => {
    if (!selectedRow) return null;
    const rangeWindow = getMesThroughputRangeWindow(rangeKey, "", "", "", Date.now());
    const buckets = buildBuckets(rangeWindow);
    const scopedEvents = mesEvents.filter((event) => matchesMachine(event, selectedRow));
    const scopedRuns = selectedRuns.filter((run) => matchesMachine(run, selectedRow));
    const fallbackState = String(selectedRow.machine_state || selectedRow.job_status || "").toLowerCase() === "running" ? "running" : "stopped";
    let cumulative = 0;
    const rows = buckets.map((bucket) => {
      const bucketEvents = scopedEvents.filter((event) => {
        const timestamp = new Date(event.happened_at || event.created_at || 0).getTime();
        return timestamp >= bucket.startAt.getTime() && timestamp < bucket.endAt.getTime();
      });
      const stateSummary = summarizeMesStateWindow(scopedEvents, bucket.startAt, bucket.endAt, fallbackState);
      const goodEvents = bucketEvents.filter((event) => String(event.event_type || "").toLowerCase() === "good_count");
      const scrapEvents = bucketEvents.filter((event) => String(event.event_type || "").toLowerCase() === "scrap_count");
      let good = goodEvents.reduce((sum, event) => sum + getMesEventQuantity(event), 0);
      let scrap = scrapEvents.reduce((sum, event) => sum + getMesEventQuantity(event), 0);
      if (goodEvents.length === 0 && scrapEvents.length === 0) {
        const bucketRuns = scopedRuns.filter((run) => {
          const timestamp = new Date(run.ended_at || run.created_at || 0).getTime();
          return timestamp >= bucket.startAt.getTime() && timestamp < bucket.endAt.getTime();
        });
        good = bucketRuns.reduce((sum, run) => sum + Number(run.good_quantity || 0), 0);
        scrap = bucketRuns.reduce((sum, run) => sum + Number(run.scrap_quantity || 0), 0);
      }
      cumulative += good + scrap;
      return { ...bucket, availability: clampPercent(stateSummary.runPct), downtime: clampPercent(stateSummary.stopPct), good, scrap, total: good + scrap, cumulative };
    });
    const productionTotal = rows.reduce((sum, row) => sum + row.total, 0);
    const goodTotal = rows.reduce((sum, row) => sum + row.good, 0);
    const availabilityAverage = rows.length ? rows.reduce((sum, row) => sum + row.availability, 0) / rows.length : 0;
    return {
      rows,
      productionTotal,
      goodTotal,
      scrapTotal: productionTotal - goodTotal,
      quality: productionTotal > 0 ? (goodTotal / productionTotal) * 100 : 0,
      availabilityAverage,
      cumulativeMaximum: Math.max(1, ...rows.map((row) => row.cumulative))
    };
  }, [mesEvents, rangeKey, selectedRow, selectedRuns]);

  if (!chartData) return null;
  return (
    <section className="factory-mes-analytics">
      <div className="factory-mes-analytics-head">
        <div><p className="workflow-section-kicker">Analytika stroja</p><h3>Výkon a dostupnosť</h3><p>Rovnaké výrobné eventy a časové okná ako v hlavnom MES dashboarde.</p></div>
        <select value={rangeKey} onChange={(event) => setRangeKey(event.target.value)}>{RANGE_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select>
      </div>
      <div className="factory-chart-kpis">
        <article><Gauge /><span>Dostupnosť</span><strong>{formatNumber(chartData.availabilityAverage, 1)} %</strong></article>
        <article><PackageCheck /><span>Vyrobené</span><strong>{formatNumber(chartData.productionTotal)}</strong></article>
        <article><Activity /><span>Kvalita</span><strong>{formatNumber(chartData.quality, 1)} %</strong></article>
        <article><BarChart3 /><span>NOK</span><strong>{formatNumber(chartData.scrapTotal)}</strong></article>
      </div>
      <div className="factory-chart-grid-layout">
        <article className="factory-chart-card"><div><span>Dostupnosť zariadenia</span><strong>{formatNumber(chartData.availabilityAverage, 1)} %</strong></div><TrendChart rows={chartData.rows} valueKey="availability" maximum={100} tone="blue" emptyLabel="Dostupnosť zatiaľ nie je evidovaná." /></article>
        <article className="factory-chart-card"><div><span>Kumulatívna produkcia</span><strong>{formatNumber(chartData.productionTotal)} ks</strong></div><TrendChart rows={chartData.rows} valueKey="cumulative" maximum={chartData.cumulativeMaximum} tone="green" emptyLabel="Produkcia zatiaľ nie je evidovaná." /></article>
        <article className="factory-chart-card factory-chart-card-wide">
          <div><span>Výroba a prestoje po intervaloch</span><strong>{formatNumber(chartData.goodTotal)} OK / {formatNumber(chartData.scrapTotal)} NOK</strong></div>
          <div className="factory-hour-bars">{chartData.rows.map((row) => <div className="factory-hour-column" key={row.key} title={`${row.label}: výroba ${formatNumber(row.availability, 1)} %, prestoj ${formatNumber(row.downtime, 1)} %`}><div className="factory-hour-stack"><span className="run" style={{ height: `${row.availability}%` }} /><span className="stop" style={{ height: `${row.downtime}%` }} /></div><small>{row.label}</small></div>)}</div>
        </article>
      </div>
    </section>
  );
});

export default MesCharts;
