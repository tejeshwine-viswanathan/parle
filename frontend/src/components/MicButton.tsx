import { useCallback, useEffect, useRef, useState } from 'react';

type Props = {
  onRecordingComplete: (audio: Blob) => void;
  disabled?: boolean;
};

const BAR_COLORS = ['#0055A4', '#ED2939', '#94A3B8', '#ED2939', '#0055A4'];

// A forgotten recording would otherwise grow without bound and take Whisper
// minutes to chew through, so stop it automatically.
const MAX_RECORDING_MS = 60_000;

export default function MicButton({ onRecordingComplete, disabled }: Props) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const autoStopRef = useRef<number | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const stopRecording = useCallback(() => {
    if (autoStopRef.current !== null) {
      window.clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    setRecording(false);
  }, []);

  useEffect(() => stopRecording, [stopRecording]);

  const startRecording = useCallback(async () => {
    if (disabled || recording) return;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stopStream();
        const audio = new Blob(chunksRef.current, { type: recorder.mimeType });
        chunksRef.current = [];
        if (audio.size > 0) onRecordingComplete(audio);
      };

      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      autoStopRef.current = window.setTimeout(stopRecording, MAX_RECORDING_MS);
    } catch {
      setError("Couldn't access the microphone — check your browser permissions.");
    }
  }, [disabled, recording, onRecordingComplete, stopStream, stopRecording]);

  const toggleRecording = useCallback(() => {
    if (recording) {
      stopRecording();
    } else {
      void startRecording();
    }
  }, [recording, startRecording, stopRecording]);

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        disabled={disabled}
        onClick={toggleRecording}
        className={`flex h-24 w-24 select-none items-center justify-center rounded-full
          text-4xl shadow-lg transition-all duration-150
          focus:outline-none focus-visible:ring-4 focus-visible:ring-sky-300
          disabled:cursor-not-allowed disabled:opacity-40
          ${
            recording
              ? 'scale-110 bg-[#ED2939] shadow-[0_0_24px_rgba(237,41,57,0.45)]'
              : 'bg-[#0055A4] shadow-[0_0_16px_rgba(0,85,164,0.35)] hover:bg-[#00468a]'
          }`}
        aria-pressed={recording}
        aria-label="Tap to talk"
      >
        🎤
      </button>

      <div className="flex h-5 items-end justify-center gap-1" aria-hidden="true">
        {BAR_COLORS.map((color, i) => (
          <span
            key={i}
            className={`w-1.5 rounded-full ${
              recording ? 'h-5 animate-[mic-eq_0.9s_ease-in-out_infinite]' : 'h-1.5'
            }`}
            style={{
              backgroundColor: color,
              transformOrigin: 'bottom',
              animationDelay: recording ? `${i * 0.12}s` : undefined,
              animationDuration: recording ? `${0.7 + (i % 3) * 0.15}s` : undefined,
            }}
          />
        ))}
      </div>

      <p role="status" className="text-sm font-medium text-slate-500 dark:text-slate-400">
        {recording ? 'Listening… tap to stop' : 'Tap to talk'}
      </p>
      {error && (
        <p role="alert" className="max-w-xs text-center text-sm text-rose-500">
          {error}
        </p>
      )}
    </div>
  );
}
