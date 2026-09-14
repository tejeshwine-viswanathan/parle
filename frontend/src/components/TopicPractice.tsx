import { useEffect, useRef, useState } from 'react';
import {
  type ChatMessage,
  type Correction,
  releaseAudio,
  speak,
  topicComplete,
  topicNudge,
  topicReview,
  topicStart,
  transcribe,
  translate,
} from '../lib/api';
import { fireConfetti } from '../lib/confetti';
import { downloadEssayPdf } from '../lib/pdf';

type Phase = 'setup' | 'ready' | 'active' | 'finished';
type TranscriptTurn = {
  id: string;
  role: 'user' | 'tutor';
  text: string;
  en?: string;
  kind?: 'completion';
  audioUrl?: string;
};
type CorrectionWithAudio = Correction & { audioUrl?: string };

const PRESET_TOPICS = [
  'Mon week-end',
  'Ma nourriture préférée',
  'Mes vacances de rêve',
  'Ma routine quotidienne',
  'Un film que j’ai aimé',
];

// How long to wait, after speech has started, before treating silence as a
// stall worth nudging. Thinking in a foreign language takes real pauses, so
// this is user-adjustable; the detection itself is just a rolling RMS check on
// the live stream, no real VAD.
const DEFAULT_STALL_SECONDS = 6;
const SPEAKING_RMS_THRESHOLD = 0.02;
const POLL_MS = 150;

// Rather than asking the model for one big example sized to however much time is
// left (unreliable — small local models tend to wrap up way short of the ask
// regardless of target), generate modest, reliably-sized chunks and let the
// learner explicitly ask for another one, as many times as they want.
const CONTINUE_CHUNK_MINUTES = 1;
// Below this much remaining target time, further chunks aren't worth offering.
const CONTINUE_MIN_REMAINING_MINUTES = 0.25;

function formatTime(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

type Props = {
  voiceId: string;
  onThinkingChange?: (thinking: boolean) => void;
};

const THINKING_STATUS = 'Parlé is thinking…';

export default function TopicPractice({ voiceId, onThinkingChange }: Props) {
  const [phase, setPhase] = useState<Phase>('setup');
  const [topic, setTopic] = useState('');
  const [targetMinutes, setTargetMinutes] = useState(3);
  const [stallSeconds, setStallSeconds] = useState(DEFAULT_STALL_SECONDS);
  const [transcriptTurns, setTranscriptTurns] = useState<TranscriptTurn[]>([]);
  const [corrections, setCorrections] = useState<CorrectionWithAudio[]>([]);
  // Grammar review runs one learner segment at a time after the session ends;
  // results stream in so the transcript is readable while the rest is checked.
  const [review, setReview] = useState<{ done: number; total: number } | null>(null);
  const [showEnglish, setShowEnglish] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [listening, setListening] = useState(false);
  // True once the learner has given up once — from then on, instead of recording,
  // they choose between reviewing what they said or hearing another example chunk.
  const [gaveUp, setGaveUp] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const voiceIdRef = useRef(voiceId);
  const stallMsRef = useRef(DEFAULT_STALL_SECONDS * 1000);
  // Nudge clips aren't kept on a transcript turn, so the previous one is
  // released whenever the next plays (and on cleanup).
  const nudgeAudioRef = useRef<string | null>(null);
  const transcriptTurnsRef = useRef(transcriptTurns);
  const correctionsRef = useRef(corrections);
  // Bumped on every reset so a still-running review from an old session can't
  // append its findings to a new one.
  const reviewRunRef = useRef(0);
  const topicHistoryRef = useRef<ChatMessage[]>([]);
  // Just the learner's own spoken segments and the generated completions, in
  // order — no opener, no nudges. This is both (a) what we hand back to the
  // model as "here's the monologue so far" so a "keep talking" chunk actually
  // continues from where the last one left off, and (b) the essay body for the
  // PDF export.
  const essayRef = useRef<string[]>([]);
  const sessionActiveRef = useRef(false);
  // Elapsed time is tracked as an accumulator + "running since" timestamp,
  // rather than a single wall-clock start time, so it can be paused during
  // backend "thinking" (transcribing, waiting on the LLM, synthesizing speech)
  // and only resumed while the user or the tutor is actually talking —
  // otherwise every bit of latency between turns silently eats into the
  // target duration.
  const accumulatedMsRef = useRef(0);
  const runningSinceRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const targetMinutesRef = useRef(targetMinutes);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // One AudioContext for the whole session, created synchronously inside the
  // "Start talking" click handler and reused across every recording segment.
  // Creating a fresh one inside each restarted segment (which happens deep in
  // an async chain, well after any user gesture) gets silently born
  // "suspended" in Chrome — the analyser then reads flat silence forever and
  // the stall-nudge logic never fires.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const pollRef = useRef<number | null>(null);
  const spokeRef = useRef(false);
  const silenceStartRef = useRef<number | null>(null);

  useEffect(() => {
    voiceIdRef.current = voiceId;
  }, [voiceId]);

  useEffect(() => {
    targetMinutesRef.current = targetMinutes;
  }, [targetMinutes]);

  useEffect(() => {
    stallMsRef.current = stallSeconds * 1000;
  }, [stallSeconds]);

  useEffect(() => {
    transcriptTurnsRef.current = transcriptTurns;
  }, [transcriptTurns]);

  useEffect(() => {
    correctionsRef.current = corrections;
  }, [corrections]);

  useEffect(() => {
    onThinkingChange?.(status === THINKING_STATUS);
    return () => onThinkingChange?.(false);
  }, [status, onThinkingChange]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [transcriptTurns]);

  // Fire-and-forget: fills in a turn's English gloss once translation resolves,
  // without blocking or delaying its audio from playing.
  function fillEnglish(turnId: string, frenchText: string) {
    translate(frenchText, 'fr-en')
      .then((en) => {
        setTranscriptTurns((t) => t.map((turn) => (turn.id === turnId ? { ...turn, en } : turn)));
      })
      .catch(() => {
        // best-effort — leave untranslated if this fails
      });
  }

  function resumeTimer() {
    if (runningSinceRef.current !== null) return; // already running
    runningSinceRef.current = Date.now();
    if (timerRef.current === null) {
      timerRef.current = window.setInterval(() => {
        const running = runningSinceRef.current !== null ? Date.now() - runningSinceRef.current : 0;
        setElapsedSeconds(Math.floor((accumulatedMsRef.current + running) / 1000));
      }, 250);
    }
  }

  function pauseTimer() {
    if (runningSinceRef.current !== null) {
      accumulatedMsRef.current += Date.now() - runningSinceRef.current;
      runningSinceRef.current = null;
    }
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setElapsedSeconds(Math.floor(accumulatedMsRef.current / 1000));
  }

  function cleanupAll() {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  }

  function releaseSessionAudio() {
    releaseAudio(
      nudgeAudioRef.current,
      ...transcriptTurnsRef.current.map((t) => t.audioUrl),
      ...correctionsRef.current.map((c) => c.audioUrl),
    );
    nudgeAudioRef.current = null;
  }

  useEffect(() => {
    return () => {
      sessionActiveRef.current = false;
      cleanupAll();
      releaseSessionAudio();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startSegment() {
    if (!sessionActiveRef.current) return;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      spokeRef.current = false;
      silenceStartRef.current = null;

      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        chunksRef.current = [];
        void handleSegmentEnd(blob);
      };
      recorderRef.current = recorder;
      recorder.start();
      setListening(true);
      resumeTimer();

      const audioCtx = audioCtxRef.current;
      if (!audioCtx) return; // shouldn't happen — created in startSession
      if (audioCtx.state === 'suspended') await audioCtx.resume();

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);

      pollRef.current = window.setInterval(() => {
        analyser.getByteTimeDomainData(data);
        let sumSquares = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sumSquares += v * v;
        }
        const rms = Math.sqrt(sumSquares / data.length);
        if (rms > SPEAKING_RMS_THRESHOLD) {
          spokeRef.current = true;
          silenceStartRef.current = null;
        } else if (spokeRef.current) {
          if (silenceStartRef.current === null) {
            silenceStartRef.current = Date.now();
          } else if (Date.now() - silenceStartRef.current >= stallMsRef.current) {
            if (pollRef.current !== null) {
              window.clearInterval(pollRef.current);
              pollRef.current = null;
            }
            source.disconnect();
            recorderRef.current?.stop();
          }
        }
      }, POLL_MS);
    } catch {
      setError("Couldn't access the microphone — check your browser permissions.");
      setListening(false);
    }
  }

  async function handleSegmentEnd(blob: Blob) {
    setListening(false);
    pauseTimer(); // no more counting while transcribing/thinking
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (!sessionActiveRef.current) return;
    if (blob.size === 0) {
      void startSegment();
      return;
    }

    try {
      setStatus('Transcribing…');
      const transcription = await transcribe(blob, 'fr');
      if (!transcription.text) {
        setStatus('');
        void startSegment();
        return;
      }

      topicHistoryRef.current = [...topicHistoryRef.current, { role: 'user', content: transcription.text }];
      essayRef.current = [...essayRef.current, transcription.text];
      setTranscriptTurns((t) => [...t, { id: crypto.randomUUID(), role: 'user', text: transcription.text }]);

      setStatus(THINKING_STATUS);
      const nudge = await topicNudge(topic, topicHistoryRef.current);
      topicHistoryRef.current = [...topicHistoryRef.current, { role: 'assistant', content: nudge }];
      const nudgeId = crypto.randomUUID();
      setTranscriptTurns((t) => [...t, { id: nudgeId, role: 'tutor', text: nudge }]);
      fillEnglish(nudgeId, nudge);

      setStatus('');
      const audioUrl = await speak(nudge, voiceIdRef.current);
      releaseAudio(nudgeAudioRef.current);
      nudgeAudioRef.current = audioUrl;
      if (audioRef.current && sessionActiveRef.current) {
        audioRef.current.src = audioUrl;
        resumeTimer(); // the tutor's nudge is still part of the practice time
        audioRef.current.onended = () => {
          if (sessionActiveRef.current) void startSegment();
        };
        void audioRef.current.play();
      } else if (sessionActiveRef.current) {
        void startSegment();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      if (sessionActiveRef.current) void startSegment();
    } finally {
      setStatus('');
    }
  }

  // Stops the current recording segment (if any) and resolves with its audio,
  // WITHOUT going through the normal transcribe-and-nudge pipeline — used by
  // handleGiveUp, which does its own thing with that audio instead.
  function stopCurrentSegment(): Promise<Blob | null> {
    return new Promise((resolve) => {
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
      const recorder = recorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        resolve(null);
        return;
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        chunksRef.current = [];
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        resolve(blob);
      };
      recorder.stop();
      recorderRef.current = null;
    });
  }

  // Generates and plays ONE modest, reliably-sized example chunk continuing the
  // monologue from wherever it currently ends — used both by the first give-up
  // and by every subsequent "keep talking" click. Never concludes the monologue
  // on the backend side; the learner decides when to stop.
  //
  // Crucially, this sends the model essayRef (the learner's speech AND every
  // prior completion, in order) rather than the full alternating chat history —
  // the backend only reads the "user" turns as "what's been said so far", so if
  // we sent the normal history, the model would never see its own earlier
  // chunks and each "keep talking" would have no idea how the last one ended.
  async function playNextChunk() {
    const remainingMinutes = Math.max(0, targetMinutesRef.current - accumulatedMsRef.current / 60000);
    const chunkMinutes = Math.min(CONTINUE_CHUNK_MINUTES, Math.max(0.5, remainingMinutes));
    setStatus('Preparing an example…');
    const monologueSoFar = essayRef.current.map((content) => ({ role: 'user' as const, content }));
    const completion = await topicComplete(topic, monologueSoFar, chunkMinutes);
    topicHistoryRef.current = [...topicHistoryRef.current, { role: 'assistant', content: completion }];
    essayRef.current = [...essayRef.current, completion];

    setStatus('');
    const audioUrl = await speak(completion, voiceIdRef.current);
    const completionId = crypto.randomUUID();
    setTranscriptTurns((t) => [
      ...t,
      { id: completionId, role: 'tutor', text: completion, kind: 'completion', audioUrl },
    ]);
    fillEnglish(completionId, completion);

    if (audioRef.current && sessionActiveRef.current) {
      audioRef.current.src = audioUrl;
      resumeTimer(); // count the example's speech toward the target time
      audioRef.current.onended = null;
      void audioRef.current.play();
    }
  }

  // The user says they don't know what else to say. First transcribe whatever
  // they were mid-sentence saying — same as a normal segment, just without the
  // short nudge — so it's shown and reviewed like anything else they said.
  // Then play one continuation chunk and hand control to the learner: from here
  // they either review what they said, or ask for another chunk (as many times
  // as they want, each one picking up accurately from where the last left off).
  async function handleGiveUp() {
    if (!sessionActiveRef.current || phase !== 'active') return;
    setError(null);
    pauseTimer(); // freeze exactly where they were — nothing below should count

    const blob = await stopCurrentSegment();
    setListening(false);

    if (blob && blob.size > 0) {
      setStatus('Transcribing…');
      try {
        const transcription = await transcribe(blob, 'fr');
        if (transcription.text) {
          topicHistoryRef.current = [...topicHistoryRef.current, { role: 'user', content: transcription.text }];
          essayRef.current = [...essayRef.current, transcription.text];
          setTranscriptTurns((t) => [...t, { id: crypto.randomUUID(), role: 'user', text: transcription.text }]);
        }
      } catch {
        // best-effort — still proceed to the completion even if this failed
      }
    }

    try {
      await playNextChunk();
      setGaveUp(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setStatus('');
    }
  }

  // "Keep talking" — generates and plays another chunk, continuing on. Stays in
  // gave-up mode so they can click it again, until they hit review instead.
  async function continueMonologue() {
    if (!sessionActiveRef.current || busy) return;
    setError(null);
    pauseTimer();
    try {
      await playNextChunk();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setStatus('');
    }
  }

  // Fetches the topic opener as text only — no autoplay, no timer, no recording.
  // The learner reads it at their own pace and starts the mic (and the clock)
  // themselves via beginRecording, so the intro doesn't eat into their target time.
  async function startSession() {
    if (!topic.trim()) return;
    // Created synchronously in this click handler, before any `await`, so the
    // browser associates it with the user gesture and doesn't start it suspended.
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new AudioContext();
    }
    void audioCtxRef.current.resume();

    setError(null);
    setTranscriptTurns([]);
    setCorrections([]);
    topicHistoryRef.current = [];
    essayRef.current = [];
    accumulatedMsRef.current = 0;
    runningSinceRef.current = null;
    setElapsedSeconds(0);
    setStatus('Getting started…');
    try {
      const opener = await topicStart(topic.trim(), targetMinutes);
      topicHistoryRef.current = [{ role: 'assistant', content: opener }];
      const openerId = crypto.randomUUID();
      setTranscriptTurns([{ id: openerId, role: 'tutor', text: opener }]);
      fillEnglish(openerId, opener);
      setStatus('');
      setPhase('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setStatus('');
    }
  }

  // Learner hits "Start recording" once they're ready — this is when the mic and
  // the target-time clock actually start, not when the topic screen loaded.
  function beginRecording() {
    setError(null);
    setGaveUp(false);
    sessionActiveRef.current = true;
    setPhase('active');
    void startSegment();
  }

  // Ends the session (from "Stop practicing" or after a "Help me finish" example
  // plays) and reviews everything the user said for real grammar mistakes — shown
  // as text by default, with audio only synthesized if the user asks for it.
  // The transcript is shown immediately; corrections stream in one segment at a
  // time, since each one is a slow LLM pass and the total can run to minutes.
  async function finishSession() {
    fireConfetti();
    sessionActiveRef.current = false;
    pauseTimer();
    cleanupAll();
    setListening(false);
    setStatus('');
    setPhase('finished');

    const userTexts = topicHistoryRef.current
      .filter((m) => m.role === 'user')
      .map((m) => m.content);
    if (userTexts.length === 0) return;

    const run = ++reviewRunRef.current;
    setReview({ done: 0, total: userTexts.length });
    for (const [i, text] of userTexts.entries()) {
      try {
        const results = await topicReview([text]);
        if (reviewRunRef.current !== run) return;
        setCorrections((cs) => [...cs, ...results.filter((c) => c.has_errors)]);
      } catch {
        // best-effort — a failed segment just shows no corrections
      }
      if (reviewRunRef.current !== run) return;
      setReview({ done: i + 1, total: userTexts.length });
    }
    setReview(null);
  }

  function generatePdf() {
    fireConfetti();
    void downloadEssayPdf({
      topic,
      targetMinutes,
      elapsedSeconds,
      paragraphs: essayRef.current,
    });
  }

  function resetSession() {
    reviewRunRef.current += 1;
    releaseSessionAudio();
    setPhase('setup');
    setTranscriptTurns([]);
    setCorrections([]);
    setReview(null);
    setElapsedSeconds(0);
    setError(null);
    setGaveUp(false);
    essayRef.current = [];
  }

  async function playCorrection(index: number) {
    const c = corrections[index];
    if (!c) return;
    setError(null);
    try {
      let audioUrl = c.audioUrl;
      if (!audioUrl) {
        audioUrl = await speak(c.corrected, voiceIdRef.current);
        setCorrections((cs) => cs.map((item, i) => (i === index ? { ...item, audioUrl } : item)));
      }
      if (audioRef.current) {
        audioRef.current.onended = null;
        audioRef.current.src = audioUrl;
        void audioRef.current.play();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    }
  }

  function replayTranscriptTurn(t: TranscriptTurn) {
    if (!t.audioUrl || !audioRef.current) return;
    audioRef.current.onended = null;
    audioRef.current.src = t.audioUrl;
    void audioRef.current.play();
  }

  const targetSeconds = targetMinutes * 60;
  const progressPct = Math.min(100, Math.round((elapsedSeconds / targetSeconds) * 100));
  const busy = status !== '';
  const remainingMinutes = targetMinutes - elapsedSeconds / 60;

  return (
    <div className="flex h-full flex-col">
      {phase === 'setup' && (
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Topic practice</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Pick a topic and just talk in French. If you stall out, Parlé will jump in with an
              idea to keep you going — no need to ask.
            </p>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-600 dark:text-slate-300">Topic</label>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. Mon week-end"
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-slate-800
                focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200
                dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {PRESET_TOPICS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTopic(t)}
                  className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600 hover:bg-slate-200
                    dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-600 dark:text-slate-300">
              Target duration: {targetMinutes} min
            </label>
            <input
              type="range"
              min={1}
              max={10}
              step={1}
              value={targetMinutes}
              onChange={(e) => setTargetMinutes(Number(e.target.value))}
              className="mt-1 w-full accent-sky-500"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-600 dark:text-slate-300">
              Pause before Parlé jumps in: {stallSeconds} s
            </label>
            <input
              type="range"
              min={3}
              max={12}
              step={1}
              value={stallSeconds}
              onChange={(e) => setStallSeconds(Number(e.target.value))}
              className="mt-1 w-full accent-sky-500"
            />
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              How long you can go quiet mid-monologue before a nudge. Longer gives you more room to think.
            </p>
          </div>
          {status && (
            <p role="status" className="text-sm animate-pulse text-slate-500 dark:text-slate-400">
              {status}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-rose-500">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={() => void startSession()}
            disabled={!topic.trim() || busy}
            className="w-full rounded-full bg-sky-500 px-5 py-2.5 font-medium text-white
              hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? 'Loading…' : 'Start talking'}
          </button>
        </div>
      )}

      {phase === 'ready' && (
        <div className="flex flex-1 flex-col justify-between overflow-y-auto px-6 py-6">
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{topic}</h2>
            {transcriptTurns[0] && (
              <div className="mr-auto max-w-lg rounded-2xl rounded-tl-sm bg-slate-100 px-4 py-2 text-slate-800 dark:bg-slate-800 dark:text-slate-100">
                <p>{transcriptTurns[0].text}</p>
                {showEnglish && transcriptTurns[0].en && (
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{transcriptTurns[0].en}</p>
                )}
              </div>
            )}
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Take a moment to think about what you'll say — the {targetMinutes}-minute timer
              and mic only start once you hit record.
            </p>
          </div>
          {error && (
            <p role="alert" className="text-sm text-rose-500">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={beginRecording}
            className="mt-4 w-full rounded-full bg-sky-500 px-5 py-2.5 font-medium text-white
              hover:bg-sky-400"
          >
            🎙️ Start recording
          </button>
        </div>
      )}

      {phase === 'active' && (
        <>
          <div className="border-b border-slate-100 px-6 py-3 dark:border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500 dark:text-slate-400">
              <span className="truncate">{topic}</span>
              <div className="flex items-center gap-3">
                <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={showEnglish}
                    onChange={(e) => setShowEnglish(e.target.checked)}
                    className="h-3.5 w-3.5 accent-sky-500"
                  />
                  Show English
                </label>
                <span className="tabular-nums">
                  {formatTime(elapsedSeconds)} / {targetMinutes}:00
                </span>
              </div>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className="h-full bg-sky-500 transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
            {transcriptTurns.map((t) => (
              <div
                key={t.id}
                className={
                  t.role === 'user'
                    ? 'ml-auto max-w-lg rounded-2xl rounded-tr-sm bg-sky-500 px-4 py-2 text-white'
                    : t.kind === 'completion'
                      ? 'mr-auto max-w-lg space-y-1 rounded-2xl rounded-tl-sm bg-emerald-50 px-4 py-2 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-300'
                      : 'mr-auto max-w-lg rounded-2xl rounded-tl-sm bg-slate-100 px-4 py-2 text-slate-800 dark:bg-slate-800 dark:text-slate-100'
                }
              >
                {t.kind === 'completion' && <p className="text-sm font-medium">🎓 Here's how you could continue</p>}
                <p>{t.text}</p>
                {showEnglish && t.role === 'tutor' && t.en && (
                  <p
                    className={
                      t.kind === 'completion'
                        ? 'mt-1 text-sm text-emerald-700/80 dark:text-emerald-400/80'
                        : 'mt-1 text-sm text-slate-500 dark:text-slate-400'
                    }
                  >
                    {t.en}
                  </p>
                )}
              </div>
            ))}
          </div>
          <div className="border-t border-slate-100 px-6 py-5 text-center dark:border-slate-800">
            {status && (
              <p role="status" className="mb-2 animate-pulse text-sm text-slate-500 dark:text-slate-400">
                {status}
              </p>
            )}
            {error && (
              <p role="alert" className="mb-2 text-sm text-rose-500">
                {error}
              </p>
            )}
            <p className="mb-3 text-sm font-medium text-slate-500 dark:text-slate-400">
              {gaveUp
                ? busy
                  ? 'Parlé is responding…'
                  : 'Want another example, a PDF, or ready to see how you did?'
                : listening
                  ? '🎙️ Listening… just keep talking'
                  : 'Parlé is responding…'}
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              {!gaveUp && (
                <button
                  type="button"
                  onClick={() => void handleGiveUp()}
                  disabled={busy}
                  className="rounded-full border border-slate-200 px-5 py-2 font-medium text-slate-600
                    hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40
                    dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  🤷 Help me finish
                </button>
              )}
              {gaveUp && (
                <button
                  type="button"
                  onClick={() => void continueMonologue()}
                  disabled={busy || remainingMinutes <= CONTINUE_MIN_REMAINING_MINUTES}
                  className="rounded-full border border-slate-200 px-5 py-2 font-medium text-slate-600
                    hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40
                    dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  🔁 Keep talking
                </button>
              )}
              <button
                type="button"
                onClick={generatePdf}
                className="rounded-full border border-slate-200 px-5 py-2 font-medium text-slate-600
                  hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                📄 Generate PDF
              </button>
              <button
                type="button"
                onClick={() => void finishSession()}
                disabled={busy}
                className="rounded-full bg-rose-500 px-5 py-2 font-medium text-white hover:bg-rose-400
                  disabled:cursor-not-allowed disabled:opacity-40"
              >
                📝 Review what I said
              </button>
            </div>
          </div>
        </>
      )}

      {phase === 'finished' && (
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-6">
          <div className="flex items-center justify-between gap-2">
            <p className="text-slate-600 dark:text-slate-300">
              Nice work — you talked for about {formatTime(elapsedSeconds)} on "{topic}".
            </p>
            <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={showEnglish}
                onChange={(e) => setShowEnglish(e.target.checked)}
                className="h-3.5 w-3.5 accent-sky-500"
              />
              Show English
            </label>
          </div>
          <div className="space-y-2 rounded-xl bg-slate-50 p-4 dark:bg-slate-800/50">
            {transcriptTurns.map((t) => (
              <div key={t.id}>
                {t.kind === 'completion' ? (
                  <div className="rounded-lg bg-emerald-50 p-2 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-300">
                    <p className="text-sm font-medium">🎓 How you could have continued:</p>
                    <p>{t.text}</p>
                    {showEnglish && t.en && (
                      <p className="mt-1 text-sm text-emerald-700/80 dark:text-emerald-400/80">{t.en}</p>
                    )}
                    {t.audioUrl && (
                      <button
                        type="button"
                        onClick={() => replayTranscriptTurn(t)}
                        className="mt-1 text-sm text-emerald-700 hover:underline dark:text-emerald-400"
                      >
                        🔊 Replay
                      </button>
                    )}
                  </div>
                ) : (
                  <p className={t.role === 'user' ? 'text-slate-800 dark:text-slate-100' : 'text-sm text-slate-400 dark:text-slate-500'}>
                    <span className="font-medium">{t.role === 'user' ? 'You: ' : 'Parlé: '}</span>
                    {t.text}
                    {showEnglish && t.role === 'tutor' && t.en && (
                      <span className="block text-xs text-slate-400 dark:text-slate-500">{t.en}</span>
                    )}
                  </p>
                )}
              </div>
            ))}
          </div>

          {review && (
            <p role="status" className="text-sm text-slate-500 dark:text-slate-400">
              <span className="animate-pulse">Checking your grammar…</span>{' '}
              <span className="tabular-nums text-slate-400 dark:text-slate-500">
                {review.done}/{review.total} segments
              </span>
            </p>
          )}
          {!review && corrections.length === 0 && transcriptTurns.some((t) => t.role === 'user') && (
            <p className="text-sm text-emerald-700 dark:text-emerald-400">✅ No grammar mistakes found — nice.</p>
          )}
          {error && (
            <p role="alert" className="text-sm text-rose-500">
              {error}
            </p>
          )}

          {corrections.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                📝 A few corrections (mistakes underlined in red)
              </h3>
              {corrections.map((c, i) => (
                <div key={i} className="rounded-xl bg-rose-50 p-3 dark:bg-rose-500/10">
                  <p className="text-slate-700 dark:text-slate-300">
                    {c.segments.map((seg, j) => (
                      <span
                        key={j}
                        className={
                          seg.wrong
                            ? 'text-rose-700 underline decoration-rose-500 decoration-2 dark:text-rose-400'
                            : undefined
                        }
                      >
                        {seg.text}
                        {j < c.segments.length - 1 ? ' ' : ''}
                      </span>
                    ))}
                  </p>
                  <p className="mt-1 text-emerald-700 dark:text-emerald-400">→ {c.corrected}</p>
                  <button
                    type="button"
                    onClick={() => void playCorrection(i)}
                    className="mt-1 text-sm text-slate-500 hover:underline dark:text-slate-400"
                  >
                    🔊 Hear the correct way
                  </button>
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={resetSession}
            className="w-full rounded-full bg-sky-500 px-5 py-2.5 font-medium text-white hover:bg-sky-400"
          >
            Practice another topic
          </button>
        </div>
      )}

      <audio ref={audioRef} className="hidden" />
    </div>
  );
}
