import { useState } from 'react';
import Practice from './tabs/Practice';
import Translate from './tabs/Translate';

type Tab = 'practice' | 'translate';

export default function App() {
  const [tab, setTab] = useState<Tab>('practice');

  return (
    <div className="mx-auto flex h-svh max-w-2xl flex-col bg-white">
      <header className="border-b border-slate-100 px-6 py-4">
        <h1 className="text-xl font-semibold text-slate-800">
          Parlé <span className="text-sky-500">🇫🇷</span>
        </h1>
        <nav className="mt-3 flex gap-1 rounded-full bg-slate-100 p-1 text-sm font-medium">
          <button
            type="button"
            onClick={() => setTab('practice')}
            className={`flex-1 rounded-full py-1.5 transition-colors ${
              tab === 'practice' ? 'bg-white text-sky-600 shadow-sm' : 'text-slate-500'
            }`}
          >
            Practice
          </button>
          <button
            type="button"
            onClick={() => setTab('translate')}
            className={`flex-1 rounded-full py-1.5 transition-colors ${
              tab === 'translate' ? 'bg-white text-sky-600 shadow-sm' : 'text-slate-500'
            }`}
          >
            Translate-to-learn
          </button>
        </nav>
      </header>

      <main className="flex-1 overflow-hidden">
        {tab === 'practice' ? <Practice /> : <Translate />}
      </main>
    </div>
  );
}
