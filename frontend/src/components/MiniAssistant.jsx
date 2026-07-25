import { useEffect, useState } from 'react';
import { postChatMessage } from '../services/api';

const PROVIDERS = [
  { label: 'OpenAI', value: 'openai', defaultModel: 'gpt-4o-mini' },
  { label: 'Google Gemini', value: 'google', defaultModel: 'gemini-1.5-flash-latest' },
];

function loadKey(key) {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(key) ?? '';
}

function saveKey(key, value) {
  if (typeof window === 'undefined') return;
  if (value) {
    window.localStorage.setItem(key, value);
  } else {
    window.localStorage.removeItem(key);
  }
}

export default function MiniAssistant({ accessToken, symbol }) {
  const [provider, setProvider] = useState('openai');
  const [model, setModel] = useState(PROVIDERS[0].defaultModel);
  const [groundWithData, setGroundWithData] = useState(true);
  const [prompt, setPrompt] = useState('Summarise bullish and bearish drivers for TSLA this week.');
  const [history, setHistory] = useState([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [openAiKey, setOpenAiKey] = useState('');
  const [googleKey, setGoogleKey] = useState('');
  const [temperature, setTemperature] = useState(0.3);

  useEffect(() => {
    setOpenAiKey(loadKey('nz-ai-openai-key'));
    setGoogleKey(loadKey('nz-ai-google-key'));
  }, []);

  useEffect(() => {
    const selected = PROVIDERS.find((item) => item.value === provider);
    if (selected) {
      setModel(selected.defaultModel);
    }
  }, [provider]);

  const runPrompt = async () => {
    if (!prompt.trim()) {
      setStatus('Prompt cannot be empty.');
      return;
    }

    const apiKey = provider === 'openai' ? openAiKey : provider === 'google' ? googleKey : '';

    setLoading(true);
    setStatus('');
    try {
      const response = await postChatMessage({
        prompt,
        provider,
        model,
        apiKey: apiKey || undefined,
        temperature,
        symbol: groundWithData && symbol ? symbol : undefined,
      }, accessToken);
      setHistory((prev) => [
        {
          id: Date.now(),
          provider: response.provider,
          model: response.model,
          prompt,
          message: response.message,
        },
        ...prev,
      ]);
      setPrompt('');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to complete request.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
        <h2 className="text-lg font-semibold text-white">AI Assistant</h2>
        <p className="mt-2 text-sm text-zinc-400">
          Chat with OpenAI or Gemini to brainstorm trade ideas, risk setups, or macro narratives. Keys entered here stay in your browser&apos;s local storage.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="text-xs font-medium text-zinc-500">
            Provider
            <select
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/25"
            >
              {PROVIDERS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-zinc-500">
            Model
            <input
              value={model}
              onChange={(event) => setModel(event.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/25"
            />
          </label>
          <label className="text-xs font-medium text-zinc-500">
            OpenAI Key (local)
            <input
              type="password"
              value={openAiKey}
              onChange={(event) => {
                setOpenAiKey(event.target.value);
                saveKey('nz-ai-openai-key', event.target.value);
              }}
              placeholder="sk-..."
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/25"
            />
          </label>
          <label className="text-xs font-medium text-zinc-500">
            Google Key (local)
            <input
              type="password"
              value={googleKey}
              onChange={(event) => {
                setGoogleKey(event.target.value);
                saveKey('nz-ai-google-key', event.target.value);
              }}
              placeholder="AIza..."
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/25"
            />
          </label>
          {symbol ? (
            <label className="flex items-center gap-2 text-xs font-medium text-zinc-500">
              <input
                type="checkbox"
                checked={groundWithData}
                onChange={(event) => setGroundWithData(event.target.checked)}
                className="h-4 w-4 accent-amber-400"
              />
              Ground with live {symbol} data (indicators, conviction, forecast, news)
            </label>
          ) : null}
          <label className="text-xs font-medium text-zinc-500">
            Temperature ({temperature.toFixed(2)})
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={temperature}
              onChange={(event) => setTemperature(Number(event.target.value))}
              className="mt-1 w-full accent-amber-400"
            />
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
        <label className="text-xs font-medium text-zinc-500">
          Prompt
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={5}
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/25"
            placeholder="Ask for position sizing guidance, risk management tweaks, or macro narratives."
          />
        </label>
        <div className="mt-3 flex items-center justify-between">
          <button
            type="button"
            onClick={runPrompt}
            disabled={loading}
            className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-zinc-900 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Generating…' : 'Send Prompt'}
          </button>
          {status ? <p className="text-sm text-red-400">{status}</p> : null}
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
        <h3 className="text-sm font-semibold text-zinc-400">Conversation</h3>
        <div className="mt-3 max-h-72 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950/60">
          <ul className="divide-y divide-zinc-800/80">
            {history.length === 0 ? (
              <li className="p-4 text-sm text-zinc-500">No AI conversations yet.</li>
            ) : (
              history.map((entry) => (
                <li key={entry.id} className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
                    <span>{entry.provider} · {entry.model}</span>
                    <span>{new Date(entry.id).toLocaleString()}</span>
                  </div>
                  <p className="text-sm font-semibold text-white">You: {entry.prompt}</p>
                  <p className="text-sm text-zinc-300 whitespace-pre-wrap">{entry.message}</p>
                </li>
              ))
            )}
          </ul>
        </div>
      </section>
    </div>
  );
}
