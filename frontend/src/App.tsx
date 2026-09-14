import { useEffect, useState } from 'react';
import Logo from './components/Logo';
import Mascot from './components/Mascot';
import VoicePicker from './components/VoicePicker';
import { health } from './lib/api';
import { useTheme } from './lib/useTheme';
import { useVoice } from './lib/useVoice';
import Practice from './tabs/Practice';
import Translate from './tabs/Translate';

type Tab = 'practice' | 'translate';

type Backend =
  | { state: 'checking' }
  | { state: 'loading'; models: Record<string, string> }
  | { state: 'error'; models: Record<string, string> }
  | { state: 'down' }
  | { state: 'ready' };

const HEALTH_POLL_MS = 2000;

const TABS: { id: Tab; label: string }[] = [
  { id: 'practice', label: 'Practice' },
  { id: 'translate', label: 'Translate-to-learn' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('practice');
  const [tutorThinking, setTutorThinking] = useState(false);
  const [backend, setBackend] = useState<Backend>({ state: 'checking' });
  const { voices, voiceId, setVoiceId } = useVoice();
  const { theme, toggleTheme } = useTheme();

  // The speech models take a while to load on a cold backend; poll until they're
  // up so the first "Transcribing…" isn't a mystery 30-second wait.
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const h = await health();
        if (cancelled) return;
        if (h.ready) {
          setBackend({ state: 'ready' });
          return;
        }
        const failed = Object.values(h.models).some((m) => m.startsWith('error'));
        setBackend({ state: failed ? 'error' : 'loading', models: h.models });
      } catch {
        if (cancelled) return;
        setBackend({ state: 'down' });
      }
      timer = window.setTimeout(() => void poll(), HEALTH_POLL_MS);
    };
    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <div className="flex h-svh flex-col bg-white dark:bg-slate-900">
      <header className="border-b border-slate-100 px-6 py-4 dark:border-slate-800">
        <div className="flex items-center justify-between">
          <h1>
            <Logo />
          </h1>
          <div className="flex items-center gap-3">
            <VoicePicker voices={voices} voiceId={voiceId} onChange={setVoiceId} />
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="flex h-8 w-8 items-center justify-center rounded-full text-lg text-slate-500
                hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
          </div>
        </div>
        <nav
          role="tablist"
          aria-label="Modes"
          className="mt-3 flex gap-1 rounded-full bg-slate-100 p-1 text-sm font-medium dark:bg-slate-800"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              onClick={() => setTab(t.id)}
              className={`flex-1 rounded-full py-1.5 transition-colors ${
                tab === t.id
                  ? 'bg-white text-sky-600 shadow-sm dark:bg-slate-700 dark:text-sky-400'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      {backend.state !== 'ready' && backend.state !== 'checking' && (
        <BackendBanner backend={backend} />
      )}

      {/* Both tabs stay mounted so switching never discards an in-progress conversation. */}
      <main className="flex-1 overflow-hidden">
        <div
          role="tabpanel"
          id="panel-practice"
          aria-labelledby="tab-practice"
          hidden={tab !== 'practice'}
          className="h-full"
        >
          <Practice voiceId={voiceId} onThinkingChange={setTutorThinking} />
        </div>
        <div
          role="tabpanel"
          id="panel-translate"
          aria-labelledby="tab-translate"
          hidden={tab !== 'translate'}
          className="h-full"
        >
          <Translate voiceId={voiceId} />
        </div>
      </main>

      <Mascot thinking={tutorThinking} />
    </div>
  );
}

const MODEL_LABELS: Record<string, string> = {
  stt: 'speech recognition',
  tts: 'voice',
  translate: 'translation',
};

function BackendBanner({ backend }: { backend: Exclude<Backend, { state: 'ready' | 'checking' }> }) {
  if (backend.state === 'down') {
    return (
      <p
        role="alert"
        className="border-b border-rose-100 bg-rose-50 px-6 py-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-500/10 dark:text-rose-300"
      >
        Can't reach the backend — start it with{' '}
        <code className="rounded bg-rose-100 px-1 dark:bg-rose-500/20">uvicorn backend.app:app --reload --port 8000</code>{' '}
        and this will clear on its own.
      </p>
    );
  }

  const entries = Object.entries(backend.models);
  if (backend.state === 'error') {
    const failed = entries.filter(([, m]) => m.startsWith('error'));
    return (
      <p
        role="alert"
        className="border-b border-rose-100 bg-rose-50 px-6 py-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-500/10 dark:text-rose-300"
      >
        {failed.map(([name, m]) => `${MODEL_LABELS[name] ?? name}: ${m.replace(/^error:\s*/, '')}`).join(' · ')}
      </p>
    );
  }

  return (
    <p
      role="status"
      className="border-b border-amber-100 bg-amber-50 px-6 py-2 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-500/10 dark:text-amber-300"
    >
      <span className="animate-pulse">Loading speech models…</span>{' '}
      <span className="text-amber-700/70 dark:text-amber-400/70">
        {entries.map(([name, m]) => `${MODEL_LABELS[name] ?? name} ${m === 'ready' ? '✓' : '…'}`).join('  ')}
      </span>
    </p>
  );
}
