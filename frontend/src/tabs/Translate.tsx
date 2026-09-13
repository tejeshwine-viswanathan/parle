import { useCallback, useRef, useState } from 'react';
import HoldToTalkButton from '../components/HoldToTalkButton';
import { speak, transcribe, translate } from '../lib/api';

type Entry = {
  id: string;
  english: string;
  french: string;
  audioUrl: string;
};

export default function Translate() {
  const [input, setInput] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const runTranslation = useCallback(async (english: string) => {
    if (!english.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setStatus('Translating…');
      const french = await translate(english, 'en-fr');

      setStatus('Generating speech…');
      const audioUrl = await speak(french);

      setEntries((e) => [{ id: crypto.randomUUID(), english, french, audioUrl }, ...e]);
      setInput('');

      if (audioRef.current) {
        audioRef.current.src = audioUrl;
        void audioRef.current.play();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
      setStatus('');
    }
  }, []);

  const handleRecording = useCallback(
    async (audio: Blob) => {
      setBusy(true);
      setError(null);
      try {
        setStatus('Transcribing…');
        const transcription = await transcribe(audio, 'en');
        if (!transcription.text) {
          setError("Didn't catch that — try again.");
          return;
        }
        setBusy(false);
        await runTranslation(transcription.text);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
        setBusy(false);
      } finally {
        setStatus('');
      }
    },
    [runTranslation],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-100 px-6 py-4">
        <p className="text-sm text-slate-500">
          Type or speak something in English — hear and see it back in French.
        </p>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
        {entries.length === 0 && (
          <div className="flex h-full items-center justify-center text-center text-slate-400">
            <p className="max-w-sm">Try "Where is the train station?" or "I'd like a coffee."</p>
          </div>
        )}
        {entries.map((entry) => (
          <div key={entry.id} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-400">{entry.english}</p>
            <p className="mt-1 text-lg font-medium text-slate-800">{entry.french}</p>
            <button
              type="button"
              onClick={() => {
                if (audioRef.current) {
                  audioRef.current.src = entry.audioUrl;
                  void audioRef.current.play();
                }
              }}
              className="mt-1 text-sm text-sky-600 hover:underline"
            >
              🔊 Replay
            </button>
          </div>
        ))}
      </div>

      <div className="border-t border-slate-100 px-6 py-5">
        {status && <p className="mb-2 text-center text-sm text-slate-500">{status}</p>}
        {error && <p className="mb-2 text-center text-sm text-rose-500">{error}</p>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void runTranslation(input);
          }}
          className="mb-4 flex gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={busy}
            placeholder="Type in English…"
            className="flex-1 rounded-full border border-slate-200 px-4 py-2 text-slate-800
              focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200
              disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="rounded-full bg-sky-500 px-5 py-2 font-medium text-white
              hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Translate
          </button>
        </form>
        <HoldToTalkButton onRecordingComplete={handleRecording} disabled={busy} />
      </div>

      <audio ref={audioRef} className="hidden" />
    </div>
  );
}
