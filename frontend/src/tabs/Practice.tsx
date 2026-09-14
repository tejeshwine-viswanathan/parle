import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FrenchTextInput from '../components/FrenchTextInput';
import MicButton from '../components/MicButton';
import TopicPractice from '../components/TopicPractice';
import { fireConfetti } from '../lib/confetti';
import {
  type ChatMessage,
  type PronunciationNote,
  phrasingSuggestion,
  releaseAudio,
  scenarioRespond,
  scenarioStart,
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
  suggestion: string | null;
  tutorFr: string;
  tutorEn: string;
  audioUrl: string;
  voice: string;
};

type FeedbackItem = { key: string; turn: Turn; kind: 'suggestion' | 'notes' };

type Mode = 'conversation' | 'topic';

type Props = {
  voiceId: string;
  onThinkingChange?: (thinking: boolean) => void;
};

const THINKING_STATUS = 'Tutor is thinking…';

// The chat history as the model sees it, derived from the visible turns so the
// two can never drift apart. In roleplay the character's opening line comes first.
function buildHistory(opener: string | null, turns: Turn[]): ChatMessage[] {
  const history: ChatMessage[] = opener ? [{ role: 'assistant', content: opener }] : [];
  for (const turn of turns) {
    history.push({ role: 'user', content: turn.userFr }, { role: 'assistant', content: turn.tutorFr });
  }
  return history;
}

export default function Practice({ voiceId, onThinkingChange }: Props) {
  const [mode, setMode] = useState<Mode>('conversation');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [showEnglish, setShowEnglish] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [speaking, setSpeaking] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [topicThinking, setTopicThinking] = useState(false);
  // Roleplay: an "option" on top of free conversation, off by default. When on
  // but not yet started, `scenario` is null and a setup form replaces the chat.
  // Once started, `scenario` holds the learner's own description and every
  // reply is generated in-character via the scenario-* endpoints instead of
  // the general tutor ones.
  const [roleplayOpen, setRoleplayOpen] = useState(false);
  const [scenario, setScenario] = useState<string | null>(null);
  const [scenarioDraft, setScenarioDraft] = useState('');
  const [scenarioOpener, setScenarioOpener] = useState<string | null>(null);
  const [scenarioOpenerEn, setScenarioOpenerEn] = useState<string | null>(null);
  const [scenarioOpenerAudio, setScenarioOpenerAudio] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const feedbackScrollRef = useRef<HTMLDivElement | null>(null);
  // One-off clips ("Hear it" on a suggestion) aren't stored on a turn, so the
  // previous one is released whenever a new one is played, and on unmount.
  const transientAudioRef = useRef<string | null>(null);
  const turnsRef = useRef(turns);
  const openerAudioRef = useRef(scenarioOpenerAudio);

  const history = useMemo(() => buildHistory(scenarioOpener, turns), [scenarioOpener, turns]);

  const feedbackItems: FeedbackItem[] = turns.flatMap((turn) => {
    const items: FeedbackItem[] = [];
    if (turn.suggestion) items.push({ key: `${turn.id}-suggestion`, turn, kind: 'suggestion' });
    if (turn.notes.length > 0) items.push({ key: `${turn.id}-notes`, turn, kind: 'notes' });
    return items;
  });

  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);

  useEffect(() => {
    openerAudioRef.current = scenarioOpenerAudio;
  }, [scenarioOpenerAudio]);

  useEffect(
    () => () =>
      releaseAudio(...turnsRef.current.map((t) => t.audioUrl), openerAudioRef.current, transientAudioRef.current),
    [],
  );

  const tutorThinking = status === THINKING_STATUS;
  useEffect(() => {
    onThinkingChange?.(tutorThinking || topicThinking);
    return () => onThinkingChange?.(false);
  }, [tutorThinking, topicThinking, onThinkingChange]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, editingId]);

  useEffect(() => {
    feedbackScrollRef.current?.scrollTo({ top: feedbackScrollRef.current.scrollHeight, behavior: 'smooth' });
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

  const stopAudio = useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
  }, []);

  // Fills in the phrasing suggestion on a turn once the (deliberately deferred)
  // request resolves. Attached only after the turn is in state, so the update
  // can't race ahead of the insert.
  const attachSuggestion = useCallback((turnId: string, suggestion: Promise<string | null>) => {
    void suggestion.then((s) => {
      if (s) setTurns((ts) => ts.map((t) => (t.id === turnId ? { ...t, suggestion: s } : t)));
    });
  }, []);

  // Runs the tutor pipeline for a piece of (already-known) French text — shared
  // by fresh recordings and by corrected re-submissions, which skip STT but
  // otherwise follow the same path.
  //
  // Ordering matters for latency: the tutor's reply is the one thing the learner
  // is actually waiting on, and Ollama serves requests in order, so it's issued
  // first. The phrasing suggestion (up to three Ollama calls) is chained *after*
  // it and lands in the feedback panel whenever it's ready. Translation runs on a
  // separate MT model, so the user's own gloss and the reply's gloss + speech all
  // overlap freely.
  const runTutorTurn = useCallback(
    async (
      userFr: string,
      notes: PronunciationNote[],
      historyBase: ChatMessage[],
    ): Promise<{ turn: Turn; suggestion: Promise<string | null> }> => {
      setStatus(THINKING_STATUS);
      const replyPromise = scenario
        ? scenarioRespond(scenario, historyBase, userFr)
        : tutorRespond(historyBase, userFr);
      const suggestion = replyPromise.then(() => phrasingSuggestion(userFr)).catch(() => null);
      const userEnPromise = translate(userFr, 'fr-en');

      const reply = await replyPromise;

      setStatus('Generating speech…');
      const [audioUrl, tutorEn, userEn] = await Promise.all([
        speak(reply, voiceId),
        translate(reply, 'fr-en'),
        userEnPromise,
      ]);

      return {
        turn: {
          id: crypto.randomUUID(),
          userFr,
          userEn,
          notes,
          suggestion: null,
          tutorFr: reply,
          tutorEn,
          audioUrl,
          voice: voiceId,
        },
        suggestion,
      };
    },
    [voiceId, scenario],
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

        const { turn, suggestion } = await runTutorTurn(transcription.text, transcription.notes, history);
        setTurns((t) => [...t, turn]);
        attachSuggestion(turn.id, suggestion);
        playAudio(turn.audioUrl);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      } finally {
        setBusy(false);
        setStatus('');
      }
    },
    [history, runTutorTurn, attachSuggestion, playAudio],
  );

  const startEdit = useCallback((turn: Turn) => {
    setEditingId(turn.id);
    setEditText(turn.userFr);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditText('');
  }, []);

  // The STT mishears what was said, so translation and the tutor's reply were
  // based on the wrong French — retype it and redo everything from that turn
  // onward. Turns after the corrected one are dropped: the conversation state
  // they were built on no longer exists once the earlier turn changes.
  const submitCorrection = useCallback(
    async (turnId: string, correctedFr: string) => {
      const text = correctedFr.trim();
      if (!text) return;
      const index = turns.findIndex((t) => t.id === turnId);
      if (index === -1) return;
      const kept = turns.slice(0, index);
      const dropped = turns.slice(index);

      setEditingId(null);
      setEditText('');
      setBusy(true);
      setError(null);
      try {
        const { turn, suggestion } = await runTutorTurn(text, [], buildHistory(scenarioOpener, kept));
        setTurns([...kept, turn]);
        releaseAudio(...dropped.map((t) => t.audioUrl));
        attachSuggestion(turn.id, suggestion);
        playAudio(turn.audioUrl);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      } finally {
        setBusy(false);
        setStatus('');
      }
    },
    [turns, scenarioOpener, runTutorTurn, attachSuggestion, playAudio],
  );

  // Stored audio is a fixed clip from whichever voice was selected when the
  // turn was created — regenerate it in the current voice before replaying
  // if the user has since switched voices.
  const replayTurn = useCallback(
    async (turn: Turn) => {
      if (turn.voice === voiceId) {
        playAudio(turn.audioUrl);
        return;
      }
      setRegeneratingId(turn.id);
      setError(null);
      try {
        const audioUrl = await speak(turn.tutorFr, voiceId);
        setTurns((ts) => ts.map((t) => (t.id === turn.id ? { ...t, audioUrl, voice: voiceId } : t)));
        playAudio(audioUrl);
        releaseAudio(turn.audioUrl);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      } finally {
        setRegeneratingId(null);
      }
    },
    [voiceId, playAudio],
  );

  const releaseConversation = useCallback(() => {
    releaseAudio(...turnsRef.current.map((t) => t.audioUrl), openerAudioRef.current);
  }, []);

  // Fetches the character's opening line for `text` and resets the conversation
  // to start fresh from it. Shared by the initial "Start roleplay" (from the
  // setup draft) and by "Clear" while a roleplay is already active, which
  // restarts the same scenario rather than dropping back to free conversation.
  const beginScenario = useCallback(
    async (text: string) => {
      setBusy(true);
      setError(null);
      setStatus('Setting the scene…');
      try {
        const opener = await scenarioStart(text);
        const [audioUrl, openerEn] = await Promise.all([
          speak(opener, voiceId),
          translate(opener, 'fr-en').catch(() => null),
        ]);
        releaseConversation();
        setScenario(text);
        setScenarioOpener(opener);
        setScenarioOpenerEn(openerEn);
        setScenarioOpenerAudio(audioUrl);
        setTurns([]);
        setEditingId(null);
        setEditText('');
        playAudio(audioUrl);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      } finally {
        setBusy(false);
        setStatus('');
      }
    },
    [voiceId, playAudio, releaseConversation],
  );

  const startRoleplay = useCallback(() => {
    const text = scenarioDraft.trim();
    if (!text) return;
    void beginScenario(text);
  }, [scenarioDraft, beginScenario]);

  const cancelRoleplaySetup = useCallback(() => {
    setRoleplayOpen(false);
    setScenarioDraft('');
  }, []);

  // Fully exits roleplay and drops back to plain free conversation.
  const endRoleplay = useCallback(() => {
    stopAudio();
    releaseConversation();
    setRoleplayOpen(false);
    setScenario(null);
    setScenarioOpener(null);
    setScenarioOpenerEn(null);
    setScenarioOpenerAudio(null);
    setScenarioDraft('');
    setTurns([]);
    setEditingId(null);
    setEditText('');
    setError(null);
    setStatus('');
  }, [stopAudio, releaseConversation]);

  const handleRoleplayToggle = useCallback(
    (checked: boolean) => {
      if (checked) {
        setRoleplayOpen(true);
      } else {
        endRoleplay();
      }
    },
    [endRoleplay],
  );

  const clearConversation = useCallback(() => {
    fireConfetti();
    if (scenario) {
      void beginScenario(scenario);
      return;
    }
    stopAudio();
    releaseConversation();
    setTurns([]);
    setEditingId(null);
    setEditText('');
    setError(null);
    setStatus('');
  }, [scenario, beginScenario, stopAudio, releaseConversation]);

  const playSuggestion = useCallback(
    async (turn: Turn) => {
      if (!turn.suggestion) return;
      setError(null);
      try {
        const audioUrl = await speak(turn.suggestion, voiceId);
        releaseAudio(transientAudioRef.current);
        transientAudioRef.current = audioUrl;
        playAudio(audioUrl);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      }
    },
    [voiceId, playAudio],
  );

  const sidebarButton = (active: boolean) =>
    `flex h-10 w-10 items-center justify-center rounded-xl text-lg transition-colors ${
      active
        ? 'bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400'
        : 'text-slate-400 hover:bg-slate-100 dark:text-slate-500 dark:hover:bg-slate-800'
    }`;

  return (
    <div className="flex h-full">
      <aside className="flex w-14 shrink-0 flex-col items-center gap-2 border-r border-slate-100 py-4 dark:border-slate-800">
        <button
          type="button"
          onClick={() => setMode('conversation')}
          aria-pressed={mode === 'conversation'}
          title="Conversation"
          className={sidebarButton(mode === 'conversation')}
        >
          💬
        </button>
        <button
          type="button"
          onClick={() => setMode('topic')}
          aria-pressed={mode === 'topic'}
          title="Topic practice"
          className={sidebarButton(mode === 'topic')}
        >
          🗣️
        </button>
      </aside>

      {/* Both modes stay mounted so switching never kills a topic session mid-recording. */}
      <div hidden={mode !== 'topic'} className="flex-1 overflow-hidden">
        <TopicPractice voiceId={voiceId} onThinkingChange={setTopicThinking} />
      </div>

      <div hidden={mode !== 'conversation'} className="relative flex h-full flex-1 overflow-hidden">
        <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-h-16 flex-wrap items-center justify-between gap-y-2 border-b border-slate-100 px-6 py-3 dark:border-slate-800">
            <p className="whitespace-nowrap text-sm text-slate-500 dark:text-slate-400">
              {turns.length === 0
                ? 'Tap the mic and say something in French to start.'
                : `${turns.length} exchange${turns.length === 1 ? '' : 's'} so far`}
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <label className="flex items-center gap-2 whitespace-nowrap text-sm font-medium text-slate-600 dark:text-slate-300">
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
                <span className="w-9 tabular-nums text-slate-500 dark:text-slate-400">{playbackRate}x</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap text-sm font-medium text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={showEnglish}
                  onChange={(e) => setShowEnglish(e.target.checked)}
                  className="h-4 w-4 accent-sky-500"
                />
                Show English
              </label>
              <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap text-sm font-medium text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={roleplayOpen || scenario !== null}
                  onChange={(e) => handleRoleplayToggle(e.target.checked)}
                  disabled={busy}
                  className="h-4 w-4 accent-sky-500"
                />
                🎭 Roleplay
              </label>
              <button
                type="button"
                onClick={() => setFeedbackOpen(true)}
                className="whitespace-nowrap text-sm font-medium text-slate-500 hover:text-sky-600 hover:underline lg:hidden dark:text-slate-400"
              >
                💡 Feedback{feedbackItems.length > 0 ? ` (${feedbackItems.length})` : ''}
              </button>
              <button
                type="button"
                onClick={clearConversation}
                disabled={(turns.length === 0 && !scenario) || busy}
                className="whitespace-nowrap text-sm font-medium text-slate-500 hover:text-rose-500 hover:underline
                  disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-400"
              >
                🗑️ Clear
              </button>
            </div>
          </div>

          {roleplayOpen && !scenario ? (
            <div className="flex flex-1 items-center justify-center overflow-y-auto px-6 py-6">
              <div className="w-full max-w-lg space-y-3">
                <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">🎭 Set up a roleplay</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Describe a character and situation — Parlé will stay in that role and push
                  back the way you describe, in French, until you end the roleplay.
                </p>
                <textarea
                  value={scenarioDraft}
                  onChange={(e) => setScenarioDraft(e.target.value)}
                  rows={4}
                  autoFocus
                  placeholder="e.g. You're my friend who's very resistant to applying for a job. Fight back and disagree with the reasons I give you, don't cave easily."
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-slate-800
                    focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200
                    dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
                {error && (
                  <p role="alert" className="text-sm text-rose-500">
                    {error}
                  </p>
                )}
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={cancelRoleplaySetup}
                    disabled={busy}
                    className="text-sm font-medium text-slate-500 hover:underline disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-400"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={startRoleplay}
                    disabled={!scenarioDraft.trim() || busy}
                    className="rounded-full bg-sky-500 px-5 py-2 font-medium text-white hover:bg-sky-400
                      disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busy ? 'Starting…' : 'Start roleplay'}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              {scenario && (
                <div className="flex items-center justify-between gap-3 border-b border-violet-100 bg-violet-50 px-6 py-2 text-sm text-violet-700
                  dark:border-violet-900/50 dark:bg-violet-500/10 dark:text-violet-300">
                  <p className="truncate">
                    <span className="font-medium">🎭 Roleplay:</span> {scenario}
                  </p>
                  <button
                    type="button"
                    onClick={endRoleplay}
                    disabled={busy}
                    className="shrink-0 font-medium hover:underline disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    End roleplay
                  </button>
                </div>
              )}

              <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
                {turns.length === 0 && !scenarioOpener && (
                  <div className="flex h-full items-center justify-center text-center text-slate-400 dark:text-slate-500">
                    <p className="max-w-sm">
                      Bonjour ! Tap the microphone below, speak a bit of French, and I'll reply
                      out loud and keep the conversation going.
                    </p>
                  </div>
                )}
                {scenarioOpener && (
                  <div className="mr-auto max-w-lg rounded-2xl rounded-tl-sm bg-slate-100 px-4 py-2 text-slate-800 dark:bg-slate-800 dark:text-slate-100">
                    <p>{scenarioOpener}</p>
                    {showEnglish && scenarioOpenerEn && (
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{scenarioOpenerEn}</p>
                    )}
                    {scenarioOpenerAudio && (
                      <button
                        type="button"
                        onClick={() => playAudio(scenarioOpenerAudio)}
                        className="mt-1 text-sm text-sky-600 hover:underline dark:text-sky-400"
                      >
                        🔊 Replay
                      </button>
                    )}
                  </div>
                )}
                {turns.map((turn) => (
                  <div key={turn.id} className="space-y-2">
                    <div className="ml-auto max-w-lg rounded-2xl rounded-tr-sm bg-sky-500 px-4 py-2 text-white">
                      {editingId === turn.id ? (
                        <div className="space-y-2 rounded-lg bg-white/10 p-2">
                          <FrenchTextInput value={editText} onChange={setEditText} rows={2} autoFocus />
                          <div className="flex justify-end gap-3 text-sm">
                            <button type="button" onClick={cancelEdit} className="text-sky-100 hover:underline">
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => void submitCorrection(turn.id, editText)}
                              disabled={!editText.trim() || busy}
                              className="rounded-full bg-white px-3 py-1 font-medium text-sky-600
                                disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Save &amp; retry
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p>{turn.userFr}</p>
                          {showEnglish && <p className="mt-1 text-sm text-sky-100">{turn.userEn}</p>}
                          <button
                            type="button"
                            onClick={() => startEdit(turn)}
                            disabled={busy}
                            className="mt-1 text-xs text-sky-100/80 hover:text-white hover:underline
                              disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            ✏️ Not what I said?
                          </button>
                        </>
                      )}
                    </div>
                    <div className="mr-auto max-w-lg rounded-2xl rounded-tl-sm bg-slate-100 px-4 py-2 text-slate-800 dark:bg-slate-800 dark:text-slate-100">
                      <p>{turn.tutorFr}</p>
                      {showEnglish && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{turn.tutorEn}</p>}
                      <button
                        type="button"
                        onClick={() => void replayTurn(turn)}
                        disabled={regeneratingId === turn.id}
                        className="mt-1 text-sm text-sky-600 hover:underline disabled:cursor-not-allowed disabled:opacity-50 dark:text-sky-400"
                      >
                        {regeneratingId === turn.id ? '⏳ Switching voice…' : '🔊 Replay'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t border-slate-100 px-6 py-5 dark:border-slate-800">
                {status && (
                  <p role="status" className="mb-2 text-center text-sm text-slate-500 dark:text-slate-400">
                    {status}
                  </p>
                )}
                {!status && speaking && (
                  <p role="status" className="mb-2 flex items-center justify-center gap-3 text-sm text-slate-500 dark:text-slate-400">
                    <span className="animate-pulse">🔊 Parlé is speaking…</span>
                    <button
                      type="button"
                      onClick={stopAudio}
                      className="rounded-full border border-slate-200 px-3 py-0.5 text-xs font-medium text-slate-600
                        hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      Stop
                    </button>
                  </p>
                )}
                {error && (
                  <p role="alert" className="mb-2 text-center text-sm text-rose-500">
                    {error}
                  </p>
                )}
                <MicButton onRecordingComplete={handleRecording} disabled={busy} />
              </div>
            </>
          )}

          <audio
            ref={audioRef}
            className="hidden"
            onPlay={() => setSpeaking(true)}
            onPause={() => setSpeaking(false)}
            onEnded={() => setSpeaking(false)}
          />
        </div>

        {/* Feedback panel: a fixed side column on wide screens, a slide-over drawer below lg. */}
        <aside
          className={`${feedbackOpen ? 'flex' : 'hidden'} absolute inset-y-0 right-0 z-10 w-full max-w-md flex-col border-l border-slate-100 bg-white shadow-xl
            lg:static lg:flex lg:w-[40rem] lg:max-w-none lg:shadow-none dark:border-slate-800 dark:bg-slate-900`}
        >
          <div className="flex min-h-16 items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <div>
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Feedback</h2>
              <p className="text-xs text-slate-400 dark:text-slate-500">Pronunciation &amp; phrasing notes</p>
            </div>
            <button
              type="button"
              onClick={() => setFeedbackOpen(false)}
              aria-label="Close feedback"
              className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 lg:hidden dark:hover:bg-slate-800"
            >
              ✕
            </button>
          </div>
          <div ref={feedbackScrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {feedbackItems.length === 0 ? (
              <div className="flex h-full items-center justify-center px-2 text-center text-sm text-slate-400 dark:text-slate-500">
                <p>Pronunciation tips and more natural phrasings will show up here as you chat.</p>
              </div>
            ) : (
              feedbackItems.map((item) =>
                item.kind === 'suggestion' ? (
                  <div
                    key={item.key}
                    className="space-y-1.5 rounded-xl border border-violet-100 bg-violet-50 px-3 py-2.5 text-sm text-violet-800
                      dark:border-violet-900/50 dark:bg-violet-500/10 dark:text-violet-300"
                  >
                    <p className="truncate text-xs font-medium text-violet-400 dark:text-violet-500" title={item.turn.userFr}>
                      “{item.turn.userFr}”
                    </p>
                    <p className="font-medium">💡 More natural way to say it</p>
                    <p className="italic">{item.turn.suggestion}</p>
                    <button
                      type="button"
                      onClick={() => void playSuggestion(item.turn)}
                      className="text-xs font-medium text-violet-600 hover:underline dark:text-violet-400"
                    >
                      🔊 Hear it
                    </button>
                  </div>
                ) : (
                  <div
                    key={item.key}
                    className="space-y-1.5 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2.5 text-sm text-amber-800
                      dark:border-amber-900/50 dark:bg-amber-500/10 dark:text-amber-300"
                  >
                    <p className="truncate text-xs font-medium text-amber-400 dark:text-amber-500" title={item.turn.userFr}>
                      “{item.turn.userFr}”
                    </p>
                    <p className="font-medium">🎯 Pronunciation tips</p>
                    {item.turn.notes.map((note, i) => (
                      <p key={i}>
                        <span className="font-medium">{note.word}</span> — {note.tip}
                      </p>
                    ))}
                  </div>
                ),
              )
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
