import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

type AccentMode = 'grave' | 'acute' | 'circumflex' | 'umlaut' | 'cedilla';

// Compose-key shortcuts: hold Ctrl + the accent mark, then the next letter gets
// accented. e.g. Ctrl+` then "e" -> "è". Mirrors how OS "US International" /
// compose-key layouts work, so it stays useful without needing one installed.
const ACCENT_MAPS: Record<AccentMode, Record<string, string>> = {
  grave: { a: 'à', e: 'è', u: 'ù', A: 'À', E: 'È', U: 'Ù' },
  acute: { e: 'é', E: 'É' },
  circumflex: { a: 'â', e: 'ê', i: 'î', o: 'ô', u: 'û', A: 'Â', E: 'Ê', I: 'Î', O: 'Ô', U: 'Û' },
  umlaut: { a: 'ä', e: 'ë', i: 'ï', o: 'ö', u: 'ü', A: 'Ä', E: 'Ë', I: 'Ï', O: 'Ö', U: 'Ü' },
  cedilla: { c: 'ç', C: 'Ç' },
};

const ACCENT_HINT: Record<AccentMode, string> = {
  grave: 'grave (a/e/u)',
  acute: 'acute (e)',
  circumflex: 'circumflex (a/e/i/o/u)',
  umlaut: 'umlaut (a/e/i/o/u)',
  cedilla: 'cedilla (c)',
};

const VIRTUAL_KEYS = ['à', 'â', 'ä', 'é', 'è', 'ê', 'ë', 'î', 'ï', 'ô', 'ö', 'œ', 'ù', 'û', 'ü', 'ç', 'æ'];

const VK_STORAGE_KEY = 'parle:virtualKeyboard';

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
  onSubmit?: () => void;
  className?: string;
};

export default function FrenchTextInput({
  value,
  onChange,
  placeholder,
  rows = 2,
  autoFocus,
  onSubmit,
  className,
}: Props) {
  const [pending, setPending] = useState<AccentMode | null>(null);
  const [showKeyboard, setShowKeyboard] = useState(() => {
    try {
      return localStorage.getItem(VK_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const pendingCursor = useRef<number | null>(null);

  useEffect(() => {
    if (pendingCursor.current !== null && ref.current) {
      const pos = pendingCursor.current;
      ref.current.setSelectionRange(pos, pos);
      pendingCursor.current = null;
    }
  }, [value]);

  const toggleKeyboard = () => {
    setShowKeyboard((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(VK_STORAGE_KEY, next ? '1' : '0');
      } catch {
        /* private browsing / storage disabled — preference just won't persist */
      }
      return next;
    });
  };

  const insertAtCursor = (char: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    pendingCursor.current = start + char.length;
    onChange(value.slice(0, start) + char + value.slice(end));
    el?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.ctrlKey && !e.altKey && !e.metaKey) {
      const armed: Record<string, AccentMode> = {
        '`': 'grave',
        "'": 'acute',
        '^': 'circumflex',
        '"': 'umlaut',
        ',': 'cedilla',
      };
      const mode = armed[e.key];
      if (mode) {
        e.preventDefault();
        setPending(mode);
        return;
      }
    }

    if (pending) {
      const mapped = ACCENT_MAPS[pending][e.key];
      setPending(null);
      if (mapped && e.key.length === 1) {
        e.preventDefault();
        insertAtCursor(mapped);
        return;
      }
      // Any other key cancels the pending accent and falls through as normal.
    }

    if (e.key === 'Enter' && !e.shiftKey && onSubmit) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className={className}>
      <div className="flex items-start gap-2">
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={rows}
          autoFocus={autoFocus}
          lang="fr"
          className="flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-slate-800
            focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200
            dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
        <button
          type="button"
          onClick={toggleKeyboard}
          aria-pressed={showKeyboard}
          title="Toggle on-screen French keyboard"
          className={`shrink-0 rounded-lg border px-2 py-2 text-sm ${
            showKeyboard
              ? 'border-sky-400 bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400'
              : 'border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400'
          }`}
        >
          ⌨️
        </button>
      </div>
      {pending && (
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
          Accent armed — {ACCENT_HINT[pending]}…
        </p>
      )}
      {!pending && (
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
          Tip: Ctrl+` e → è, Ctrl+' e → é, Ctrl+^ e → ê, Ctrl+, c → ç
        </p>
      )}
      {showKeyboard && (
        <div className="mt-2 flex flex-wrap gap-1 rounded-xl bg-slate-50 p-2 dark:bg-slate-800">
          {VIRTUAL_KEYS.map((char) => (
            <button
              key={char}
              type="button"
              onClick={() => insertAtCursor(char)}
              className="h-8 w-8 rounded-md bg-white text-slate-700 shadow-sm hover:bg-sky-50 hover:text-sky-600
                dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-sky-500/10 dark:hover:text-sky-400"
            >
              {char}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
