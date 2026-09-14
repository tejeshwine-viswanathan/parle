import { useCallback, useEffect, useRef, useState } from 'react';
import MicButton from '../components/MicButton';
import { releaseAudio, speak, transcribe, translate } from '../lib/api';

type Entry = {
  id: string;
  english: string;
  french: string;
  audioUrl: string;
  voice: string;
};

type Props = {
  voiceId: string;
};

export default function Translate({ voiceId }: Props) {
  const [input, setInput] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const entriesRef = useRef(entries);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  useEffect(() => () => releaseAudio(...entriesRef.current.map((e) => e.audioUrl)), []);

  const runTranslation = useCallback(
    async (english: string) => {
      if (!english.trim()) return;
      setBusy(true);
      setError(null);
      try {
        setStatus('Translating…');
        const french = await translate(english, 'en-fr');

        setStatus('Generating speech…');
        const audioUrl = await speak(french, voiceId);

        setEntries((e) => [{ id: crypto.randomUUID(), english, french, audioUrl, voice: voiceId }, ...e]);
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
    },
    [voiceId],
  );

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

  const replayEntry = useCallback(
    async (entry: Entry) => {
      let audioUrl = entry.audioUrl;
      if (entry.voice !== voiceId) {
        setRegeneratingId(entry.id);
        setError(null);
        try {
          audioUrl = await speak(entry.french, voiceId);
          setEntries((es) => es.map((e) => (e.id === entry.id ? { ...e, audioUrl, voice: voiceId } : e)));
          releaseAudio(entry.audioUrl);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Something went wrong.');
          return;
        } finally {
          setRegeneratingId(null);
        }
      }
      if (audioRef.current) {
        audioRef.current.src = audioUrl;
        void audioRef.current.play();
      }
    },
    [voiceId],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-100 px-6 py-4 dark:border-slate-800">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Type or speak something in English — hear and see it back in French.
        </p>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
        {entries.length === 0 && (
          <div className="flex h-full items-center justify-center text-center text-slate-400 dark:text-slate-500">
            <p className="max-w-sm">Try "Where is the train station?" or "I'd like a coffee."</p>
          </div>
        )}
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm
              dark:border-slate-800 dark:bg-slate-800/50"
          >
            <p className="text-sm text-slate-400 dark:text-slate-500">{entry.english}</p>
            <p className="mt-1 text-lg font-medium text-slate-800 dark:text-slate-100">{entry.french}</p>
            <button
              type="button"
              onClick={() => void replayEntry(entry)}
              disabled={regeneratingId === entry.id}
              className="mt-1 text-sm text-sky-600 hover:underline disabled:cursor-not-allowed disabled:opacity-50 dark:text-sky-400"
            >
              {regeneratingId === entry.id ? '⏳ Switching voice…' : '🔊 Replay'}
            </button>
          </div>
        ))}
      </div>

      <div className="border-t border-slate-100 px-6 py-5 dark:border-slate-800">
        {status && (
          <p role="status" className="mb-2 text-center text-sm text-slate-500 dark:text-slate-400">
            {status}
          </p>
        )}
        {error && (
          <p role="alert" className="mb-2 text-center text-sm text-rose-500">
            {error}
          </p>
        )}
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
              disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
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
        <MicButton onRecordingComplete={handleRecording} disabled={busy} />
      </div>

      <audio ref={audioRef} className="hidden" />
    </div>
  );
}
