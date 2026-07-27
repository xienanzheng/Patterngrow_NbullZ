// Forecast accountability: snapshot what the models said, then grade those
// snapshots against what actually happened once the horizon has passed.

import { supabaseAdmin } from './supabaseClient.js';

export async function logForecastSnapshot({
  symbol, lastClose, forecastModel, horizon, base, lower, upper, convictionScore, convictionLabel, probUp,
}) {
  try {
    const snapshotDate = new Date().toISOString().slice(0, 10);
    // One row per (symbol × date × model) — allows comparing multiple models on the same day.
    const { error } = await supabaseAdmin.from('forecast_log').upsert({
      symbol,
      snapshot_date: snapshotDate,
      last_close: lastClose,
      forecast_model: forecastModel,
      horizon,
      base,
      lower,
      upper,
      conviction_score: convictionScore,
      conviction_label: convictionLabel,
      prob_up: probUp,
    }, { onConflict: 'symbol,snapshot_date,forecast_model' });
    if (error) throw error;
    return true;
  } catch (err) {
    // Table may not exist yet; the log is best-effort by design.
    console.warn('forecast_log write skipped:', err.message);
    return false;
  }
}

// Pure: grade snapshots against a date->close map built from real history.
// A snapshot is gradable once some close exists on/after its target date.
export function gradeSnapshots(snapshots, closesByDate) {
  const sortedDates = Object.keys(closesByDate).sort();
  const firstDate = sortedDates[0];
  const rows = [];

  snapshots.forEach((snap) => {
    const target = addCalendarDays(snap.snapshot_date, snap.horizon);
    // A target before the fetched history window would otherwise "match" the
    // window's first bar and grade the forecast against a far-later close.
    if (firstDate && target < firstDate) return;
    const actualDate = sortedDates.find((d) => d >= target);
    if (!actualDate) return; // horizon not reached yet
    const actual = closesByDate[actualDate];
    if (!Number.isFinite(actual)) return;

    const inBand = snap.lower != null && snap.upper != null
      ? actual >= Number(snap.lower) && actual <= Number(snap.upper)
      : null;
    const predictedDir = Math.sign(Number(snap.base) - Number(snap.last_close));
    const actualDir = Math.sign(actual - Number(snap.last_close));
    const directionHit = actualDir === 0 ? null : predictedDir === actualDir;

    rows.push({
      snapshotDate: snap.snapshot_date,
      targetDate: target,
      actualDate,
      model: snap.forecast_model,
      horizon: snap.horizon,
      lastClose: Number(snap.last_close),
      base: Number(snap.base),
      lower: snap.lower != null ? Number(snap.lower) : null,
      upper: snap.upper != null ? Number(snap.upper) : null,
      actual,
      inBand,
      directionHit,
      convictionLabel: snap.conviction_label ?? null,
      probUp: snap.prob_up != null ? Number(snap.prob_up) : null,
    });
  });

  const graded = rows.filter((r) => r.inBand != null);
  const dirGraded = rows.filter((r) => r.directionHit != null);
  return {
    rows,
    summary: {
      graded: rows.length,
      bandHitRate: graded.length ? graded.filter((r) => r.inBand).length / graded.length : null,
      directionHitRate: dirGraded.length ? dirGraded.filter((r) => r.directionHit).length / dirGraded.length : null,
    },
  };
}

export function addCalendarDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString().slice(0, 10);
}

export async function fetchSnapshots(symbol, limit = 120) {
  const { data, error } = await supabaseAdmin
    .from('forecast_log')
    .select('*')
    .eq('symbol', symbol)
    .order('snapshot_date', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}
