import { useCallback, useEffect, useState } from 'react';
import { createAlert, deleteAlert, getAlerts, markAlertEventsSeen } from '../services/api';

const RULES = [
  { value: 'price_above', label: 'Price above…', needsThreshold: true },
  { value: 'price_below', label: 'Price below…', needsThreshold: true },
  { value: 'rsi_overbought', label: 'RSI overbought (confirmed 2 sessions)', needsThreshold: false },
  { value: 'rsi_oversold', label: 'RSI oversold (confirmed 2 sessions)', needsThreshold: false },
  { value: 'conviction_flip', label: 'Ensemble conviction flips', needsThreshold: false },
];

const ruleLabel = (value) => RULES.find((r) => r.value === value)?.label ?? value;

export default function AlertsPanel({ accessToken, defaultSymbol }) {
  const [alerts, setAlerts] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [form, setForm] = useState({ symbol: defaultSymbol ?? '', ruleType: 'price_above', threshold: '' });

  const selectedRule = RULES.find((r) => r.value === form.ruleType);

  const refresh = useCallback(async () => {
    if (!accessToken) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const payload = await getAlerts(accessToken);
      setAlerts(payload?.alerts ?? []);
      setEvents(payload?.events ?? []);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Unable to load alerts.');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleCreate = async (event) => {
    event.preventDefault();
    setStatus('');
    if (!form.symbol.trim()) {
      setStatus('Symbol is required.');
      return;
    }
    if (selectedRule?.needsThreshold && !(Number(form.threshold) > 0)) {
      setStatus('Enter a positive price threshold.');
      return;
    }
    try {
      await createAlert({
        symbol: form.symbol.trim().toUpperCase(),
        ruleType: form.ruleType,
        threshold: selectedRule?.needsThreshold ? Number(form.threshold) : undefined,
      }, accessToken);
      setForm((prev) => ({ ...prev, threshold: '' }));
      setStatus('Alert created. Rules are evaluated once each weekday after US market close.');
      await refresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not create alert.');
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteAlert(id, accessToken);
      await refresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not delete alert.');
    }
  };

  const unseenCount = events.filter((e) => !e.seen).length;

  const handleMarkSeen = async () => {
    try {
      await markAlertEventsSeen(accessToken);
      await refresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not update events.');
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <h2 className="text-lg font-semibold text-white">Create Alert</h2>
        <p className="mt-1 text-xs text-slate-400">
          Rules run once each weekday after US market close (requires the CRON_SECRET env var and the Supabase alerts tables).
        </p>
        <form onSubmit={handleCreate} className="mt-4 grid gap-3 md:grid-cols-4">
          <input
            type="text"
            value={form.symbol}
            onChange={(e) => setForm((prev) => ({ ...prev, symbol: e.target.value.toUpperCase() }))}
            placeholder="Symbol"
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          />
          <select
            value={form.ruleType}
            onChange={(e) => setForm((prev) => ({ ...prev, ruleType: e.target.value }))}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 md:col-span-2"
          >
            {RULES.map((rule) => (
              <option key={rule.value} value={rule.value}>{rule.label}</option>
            ))}
          </select>
          {selectedRule?.needsThreshold ? (
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.threshold}
              onChange={(e) => setForm((prev) => ({ ...prev, threshold: e.target.value }))}
              placeholder="Price ($)"
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            />
          ) : <div />}
          <button
            type="submit"
            disabled={!accessToken}
            className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-60 md:col-start-4"
          >
            Add Alert
          </button>
        </form>
        {status ? <p className="mt-3 text-sm text-blue-200">{status}</p> : null}
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Active Rules</h3>
        {loading ? (
          <p className="mt-3 text-sm text-slate-400">Loading…</p>
        ) : alerts.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No alerts yet. Create your first rule above.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {alerts.map((alert) => (
              <li key={alert.id} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 text-sm">
                <span>
                  <span className="font-semibold text-white">{alert.symbol}</span>
                  <span className="ml-2 text-slate-300">{ruleLabel(alert.rule_type)}</span>
                  {alert.threshold != null ? <span className="ml-1 text-slate-400">${Number(alert.threshold).toFixed(2)}</span> : null}
                  {alert.last_triggered_at ? (
                    <span className="ml-2 text-xs text-slate-500">last fired {new Date(alert.last_triggered_at).toLocaleDateString()}</span>
                  ) : null}
                </span>
                <button
                  type="button"
                  onClick={() => handleDelete(alert.id)}
                  className="text-xs font-medium text-slate-400 transition hover:text-red-400"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Triggered Events {unseenCount > 0 ? <span className="ml-2 rounded-full bg-blue-500/20 px-2 py-0.5 text-xs text-blue-200">{unseenCount} new</span> : null}
          </h3>
          {unseenCount > 0 ? (
            <button
              type="button"
              onClick={handleMarkSeen}
              className="text-xs font-semibold text-blue-300 underline-offset-2 hover:underline"
            >
              Mark all seen
            </button>
          ) : null}
        </div>
        {events.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Nothing triggered yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {events.map((event) => (
              <li
                key={event.id}
                className={`rounded-lg border px-3 py-2 text-sm ${
                  event.seen ? 'border-slate-800 bg-slate-950/50 text-slate-400' : 'border-blue-500/40 bg-blue-500/10 text-slate-200'
                }`}
              >
                <span className="font-semibold text-white">{event.symbol}</span>
                <span className="ml-2">{event.message}</span>
                <span className="ml-2 text-xs text-slate-500">{new Date(event.triggered_at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
