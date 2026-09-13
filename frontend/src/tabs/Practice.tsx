import { useCallback, useEffect, useRef, useState } from 'react';
import MicButton from '../components/MicButton';
import {
  type ChatMessage,
  type PronunciationNote,
  speak,
  transcribe,
  translate,
  tutorRespond,
} from '../lib/api';

type Turn = {
  id: string;
  userFr: string;
  userEn: string;
  notes: PronunciationNote[];
  tutorFr: string;
  tutorEn: string;
  audioUrl: string;
};

export default function Practice() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [showEnglish, setShowEnglish] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  const playAudio = useCallback(
    (url: string) => {
      if (!audioRef.current) return;
      audioRef.current.src = url;
      audioRef.current.playbackRate = playbackRate;
      void audioRef.current.play();
    },
    [playbackRate],
  );

  const handleRecording = useCallback(
    async (audio: Blob) => {
      setBusy(true);
      setError(null);
      try {
        setStatus('Transcribing…');
        const transcription = await transcribe(audio);
        if (!transcription.text) {
          setError("Didn't catch that — try speaking a bit louder or longer.");
          return;
        }

        setStatus('Translating…');
        const userEn = await translate(transcription.text, 'fr-en');

        setStatus('Tutor is thinking…');
        const reply = await tutorRespond(history, transcription.text);

        setStatus('Translating reply…');
        const tutorEn = await translate(reply, 'fr-en');

        setStatus('Generating speech…');
        const audioUrl = await speak(reply);

        setHistory((h) => [
          ...h,
          { role: 'user', content: transcription.text },
          { role: 'assistant', content: reply },
        ]);
        setTurns((t) => [
          ...t,
          {
            id: crypto.randomUUID(),
            userFr: transcription.text,
            userEn,
            notes: transcription.notes,
            tutorFr: reply,
            tutorEn,
            audioUrl,
          },
        ]);

        playAudio(audioUrl);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      } finally {
        setBusy(false);
        setStatus('');
      }
    },
    [history, playAudio],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-3">
        <p className="text-sm text-slate-500">
          {turns.length === 0
            ? 'Tap the mic and say something in French to start.'
            : `${turns.length} exchange${turns.length === 1 ? '' : 's'} so far`}
        </p>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
            Speed
            <input
              type="range"
              min={0.5}
              max={1.25}
              step={0.25}
              value={playbackRate}
              onChange={(e) => setPlaybackRate(Number(e.target.value))}
              className="w-20 accent-sky-500"
            />
            <span className="w-9 tabular-nums text-slate-500">{playbackRate}x</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-600">
            <input
              type="checkbox"
              checked={showEnglish}
              onChange={(e) => setShowEnglish(e.target.checked)}
              className="h-4 w-4 accent-sky-500"
            />
            Show English
          </label>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
        {turns.length === 0 && (
          <div className="flex h-full items-center justify-center text-center text-slate-400">
            <p className="max-w-sm">
              Bonjour ! Tap the microphone below, speak a bit of French, and I'll reply
              out loud and keep the conversation going.
            </p>
          </div>
        )}
        {turns.map((turn) => (
          <div key={turn.id} className="space-y-2">
            <div className="ml-auto max-w-lg rounded-2xl rounded-tr-sm bg-sky-500 px-4 py-2 text-white">
              <p>{turn.userFr}</p>
              {showEnglish && <p className="mt-1 text-sm text-sky-100">{turn.userEn}</p>}
            </div>
            {turn.notes.length > 0 && (
              <div className="ml-auto max-w-lg space-y-1 rounded-2xl bg-amber-50 px-4 py-2 text-sm text-amber-800">
                <p className="font-medium">Pronunciation tips</p>
                {turn.notes.map((note, i) => (
                  <p key={i}>
                    <span className="font-medium">{note.word}</span> — {note.tip}
                  </p>
                ))}
              </div>
            )}
            <div className="mr-auto max-w-lg rounded-2xl rounded-tl-sm bg-slate-100 px-4 py-2 text-slate-800">
              <p>{turn.tutorFr}</p>
              {showEnglish && <p className="mt-1 text-sm text-slate-500">{turn.tutorEn}</p>}
              <button
                type="button"
                onClick={() => playAudio(turn.audioUrl)}
                className="mt-1 text-sm text-sky-600 hover:underline"
              >
                🔊 Replay
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-slate-100 px-6 py-5">
        {status && <p className="mb-2 text-center text-sm text-slate-500">{status}</p>}
        {error && <p className="mb-2 text-center text-sm text-rose-500">{error}</p>}
        <MicButton onRecordingComplete={handleRecording} disabled={busy} />
      </div>

      <audio ref={audioRef} className="hidden" />
    </div>
  );
}
