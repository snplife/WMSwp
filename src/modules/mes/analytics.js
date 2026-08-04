import { getMesStateTransitionFromEvent } from './events';
import { safeRatioPercent } from './formatters';

export const MES_MAX_DOWNTIME_DURATION_MS = 5 * 60 * 60 * 1000;
export const MES_MAX_CONTINUOUS_RUN_MS = 10 * 60 * 1000;
const MES_PRODUCTION_DURATION_ADJUSTMENT_SECONDS_BY_TERMINAL_CODE = {
  "P4-80F1B2D1F87A": 18
};
const MES_PRODUCTION_DURATION_EVENT_TYPES = new Set(["start", "resume"]);

export function summarizeMesStateWindow(events, startAt, endAt, fallbackState = "running", options = {}) {
  const startMs = new Date(startAt || 0).getTime();
  const resolvedEndAt = endAt || new Date().toISOString();
  const endMs = new Date(resolvedEndAt).getTime();
  const maxStopSegmentMs =
    Number.isFinite(options.maxStopSegmentMs) && options.maxStopSegmentMs > 0
      ? options.maxStopSegmentMs
      : MES_MAX_DOWNTIME_DURATION_MS;
  const maxRunSegmentMs =
    Number.isFinite(options.maxRunSegmentMs) && options.maxRunSegmentMs > 0
      ? options.maxRunSegmentMs
      : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return {
      totalMs: 0,
      runMs: 0,
      stopMs: 0,
      runPct: 0,
      stopPct: 0
    };
  }

  const orderedEvents = [...(events || [])]
    .filter((row) => row?.happened_at)
    .sort((a, b) => new Date(a.happened_at || 0).getTime() - new Date(b.happened_at || 0).getTime());

  let currentState = fallbackState === "stopped" ? "stopped" : "running";
  let currentStateStartedMs = startMs;
  let cursorMs = startMs;
  let runMs = 0;
  let stopMs = 0;
  const addStateDuration = (state, segmentStartMs, segmentEndMs, stateStartedMs) => {
    const durationMs = Math.max(0, segmentEndMs - segmentStartMs);
    if (durationMs <= 0) {
      return;
    }
    if (state === "running") {
      const runDeadlineMs = stateStartedMs + maxRunSegmentMs;
      const cappedRunMs = Math.max(0, Math.min(segmentEndMs, runDeadlineMs) - segmentStartMs);
      runMs += cappedRunMs;
      stopMs += Math.max(0, durationMs - cappedRunMs);
    } else if (durationMs <= maxStopSegmentMs) {
      stopMs += durationMs;
    }
  };

  orderedEvents.forEach((event) => {
    const happenedMs = new Date(event.happened_at || 0).getTime();
    if (!Number.isFinite(happenedMs)) {
      return;
    }
    const nextState = getMesStateTransitionFromEvent(event.event_type);
    if (!nextState) {
      return;
    }
    if (happenedMs <= startMs) {
      currentState = nextState;
      currentStateStartedMs = happenedMs;
      return;
    }
    if (happenedMs >= endMs) {
      return;
    }
    addStateDuration(currentState, cursorMs, happenedMs, currentStateStartedMs);
    cursorMs = happenedMs;
    currentState = nextState;
    currentStateStartedMs = happenedMs;
  });

  addStateDuration(currentState, cursorMs, endMs, currentStateStartedMs);

  const totalMs = Math.max(0, endMs - startMs);
  return {
    totalMs,
    runMs,
    stopMs,
    runPct: safeRatioPercent(runMs, totalMs),
    stopPct: safeRatioPercent(stopMs, totalMs)
  };
}

export function averageMesNumber(values) {
  const samples = (values || []).filter((value) => Number.isFinite(value) && Number(value) > 0);
  if (samples.length === 0) {
    return null;
  }
  return samples.reduce((sum, value) => sum + Number(value), 0) / samples.length;
}

export function getMesEventQuantity(row) {
  const eventType = String(row?.event_type || row?.event_code || "").trim().toLowerCase();
  const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
  const quantityCandidates =
    eventType === "good_count"
      ? [row?.quantity, payload.good_quantity, payload.ok_qty, payload.quantity, payload.qty, payload.count]
      : eventType === "scrap_count"
        ? [row?.quantity, payload.scrap_quantity, payload.nok_qty, payload.quantity, payload.qty, payload.count]
        : [row?.quantity, payload.quantity, payload.qty, payload.count];
  const rawQuantity = Number(quantityCandidates.find((value) => Number.isFinite(Number(value)) && Number(value) > 0) || 0);
  return Number.isFinite(rawQuantity) && rawQuantity > 0 ? rawQuantity : 1;
}

export function sumMesEventQuantities(events, eventTypes = []) {
  const allowedTypes = new Set((eventTypes || []).map((value) => String(value || "").trim().toLowerCase()).filter(Boolean));
  return (events || []).reduce((sum, row) => {
    const eventType = String(row?.event_type || "").trim().toLowerCase();
    if (allowedTypes.size > 0 && !allowedTypes.has(eventType)) {
      return sum;
    }
    return sum + getMesEventQuantity(row);
  }, 0);
}

export function getMesEventDurationMs(row) {
  const eventType = String(row?.event_type || row?.event_code || row?.payload?.compact_event || "").trim().toLowerCase();
  const terminalCode = String(row?.terminal_code || row?.payload?.terminal_code || "").trim().toUpperCase();
  const adjustmentSeconds =
    MES_PRODUCTION_DURATION_EVENT_TYPES.has(eventType)
      ? Number(MES_PRODUCTION_DURATION_ADJUSTMENT_SECONDS_BY_TERMINAL_CODE[terminalCode] || 0)
      : 0;
  const adjustmentMs = Number.isFinite(adjustmentSeconds) && adjustmentSeconds > 0 ? adjustmentSeconds * 1000 : 0;
  const explicitSeconds = Number(row?.duration_seconds || row?.payload?.duration_seconds || 0);
  if (Number.isFinite(explicitSeconds) && explicitSeconds > 0) {
    return Math.max(0, explicitSeconds * 1000 + adjustmentMs);
  }

  const timeFromMs = new Date(row?.time_from || row?.payload?.time_from || 0).getTime();
  const timeToMs = new Date(row?.time_to || row?.happened_at || row?.created_at || 0).getTime();
  if (Number.isFinite(timeFromMs) && Number.isFinite(timeToMs) && timeToMs > timeFromMs) {
    return Math.max(0, timeToMs - timeFromMs + adjustmentMs);
  }

  return 0;
}

export function collectMesEventDurations(events, eventTypes = [], options = {}) {
  const allowedTypes = new Set((eventTypes || []).map((value) => String(value || "").trim().toLowerCase()).filter(Boolean));
  const startMs = options.startAt ? new Date(options.startAt).getTime() : Number.NEGATIVE_INFINITY;
  const endMs = options.endAt ? new Date(options.endAt).getTime() : Number.POSITIVE_INFINITY;
  const maxDurationMs = Number.isFinite(options.maxDurationMs) && options.maxDurationMs > 0 ? options.maxDurationMs : Number.POSITIVE_INFINITY;

  return [...(events || [])]
    .filter((row) => {
      const eventType = String(row?.event_type || "").trim().toLowerCase();
      return allowedTypes.size === 0 || allowedTypes.has(eventType);
    })
    .map((row) => {
      const happenedMs = new Date(row?.happened_at || row?.created_at || 0).getTime();
      return {
        row,
        happenedMs,
        durationMs: getMesEventDurationMs(row)
      };
    })
    .filter(({ happenedMs, durationMs }) => {
      return (
        Number.isFinite(happenedMs) &&
        happenedMs >= startMs &&
        happenedMs <= endMs &&
        Number.isFinite(durationMs) &&
        durationMs > 0 &&
        durationMs <= maxDurationMs
      );
    });
}

export function collectMesEventDeltaDurations(events, eventTypes = [], options = {}) {
  const allowedTypes = new Set((eventTypes || []).map((value) => String(value || "").trim().toLowerCase()).filter(Boolean));
  const startMs = options.startAt ? new Date(options.startAt).getTime() : Number.NEGATIVE_INFINITY;
  const endMs = options.endAt ? new Date(options.endAt).getTime() : Number.POSITIVE_INFINITY;
  const maxGapMs = Number.isFinite(options.maxGapMs) && options.maxGapMs > 0 ? options.maxGapMs : Number.POSITIVE_INFINITY;

  const ordered = [...(events || [])]
    .filter((row) => {
      const eventType = String(row?.event_type || "").trim().toLowerCase();
      return (allowedTypes.size === 0 || allowedTypes.has(eventType)) && row?.happened_at;
    })
    .sort((a, b) => new Date(a.happened_at || 0).getTime() - new Date(b.happened_at || 0).getTime());

  const durations = [];
  let previousMs = null;

  ordered.forEach((row) => {
    const happenedMs = new Date(row?.happened_at || row?.created_at || 0).getTime();
    if (!Number.isFinite(happenedMs) || happenedMs < startMs || happenedMs > endMs) {
      return;
    }
    if (previousMs !== null) {
      const deltaMs = happenedMs - previousMs;
      if (deltaMs > 0 && deltaMs <= maxGapMs) {
        durations.push({
          startMs: previousMs,
          endMs: happenedMs,
          durationMs: deltaMs
        });
      }
    }
    previousMs = happenedMs;
  });

  return durations;
}

export function collectMesDowntimeDurations(events, options = {}) {
  const {
    openEventTypes = ["ml"],
    closeEventTypes = ["start"],
    startAt = "",
    endAt = "",
    maxDurationMs = Number.POSITIVE_INFINITY
  } = options;
  const startMs = startAt ? new Date(startAt).getTime() : Number.NEGATIVE_INFINITY;
  const endMs = endAt ? new Date(endAt).getTime() : Number.POSITIVE_INFINITY;
  const orderedEvents = [...(events || [])]
    .filter((row) => row?.happened_at)
    .sort((a, b) => new Date(a.happened_at || 0).getTime() - new Date(b.happened_at || 0).getTime());
  const durations = [];
  let activeStartMs = null;

  orderedEvents.forEach((event) => {
    const eventType = String(event?.event_type || "").trim().toLowerCase();
    const happenedMs = new Date(event?.happened_at || 0).getTime();
    if (!Number.isFinite(happenedMs)) {
      return;
    }
    if (openEventTypes.includes(eventType)) {
      activeStartMs = Math.max(happenedMs, startMs);
      return;
    }
    if (!closeEventTypes.includes(eventType) || activeStartMs === null) {
      return;
    }
    if (happenedMs < startMs) {
      return;
    }
    const resolvedEndMs = Math.min(happenedMs, endMs);
    if (resolvedEndMs > activeStartMs && resolvedEndMs - activeStartMs <= maxDurationMs) {
      durations.push({
        startMs: activeStartMs,
        endMs: resolvedEndMs,
        durationMs: Math.max(0, resolvedEndMs - activeStartMs)
      });
    }
    activeStartMs = null;
  });

  return durations;
}
