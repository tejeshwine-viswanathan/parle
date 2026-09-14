import { useState } from 'react';
import Logo from './components/Logo';
import Mascot from './components/Mascot';
import VoicePicker from './components/VoicePicker';
import { useTheme } from './lib/useTheme';
import { useVoice } from './lib/useVoice';
import Practice from './tabs/Practice';
import Translate from './tabs/Translate';

type Tab = 'practice' | 'translate';

export default function App() {
  const [tab, setTab] = useState<Tab>('practice');
  const [tutorThinking, setTutorThinking] = useState(false);
  const { voices, voiceId, setVoiceId } = useVoice();
  const { theme, toggleTheme } = useTheme();

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
        <nav className="mt-3 flex gap-1 rounded-full bg-slate-100 p-1 text-sm font-medium dark:bg-slate-800">
          <button
            type="button"
            onClick={() => setTab('practice')}
            className={`flex-1 rounded-full py-1.5 transition-colors ${
              tab === 'practice'
                ? 'bg-white text-sky-600 shadow-sm dark:bg-slate-700 dark:text-sky-400'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            Practice
          </button>
          <button
            type="button"
            onClick={() => setTab('translate')}
            className={`flex-1 rounded-full py-1.5 transition-colors ${
              tab === 'translate'
                ? 'bg-white text-sky-600 shadow-sm dark:bg-slate-700 dark:text-sky-400'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            Translate-to-learn
          </button>
        </nav>
      </header>

      <main className="flex-1 overflow-hidden">
        {tab === 'practice' ? (
          <Practice voiceId={voiceId} onThinkingChange={setTutorThinking} />
        ) : (
          <Translate voiceId={voiceId} />
        )}
      </main>

      <Mascot thinking={tab === 'practice' && tutorThinking} />
    </div>
  );
}
