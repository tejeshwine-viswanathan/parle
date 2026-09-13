import { useCallback, useRef, useState } from 'react';

type Props = {
  onRecordingComplete: (audio: Blob) => void;
  disabled?: boolean;
};

export default function MicButton({ onRecordingComplete, disabled }: Props) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

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
    } catch {
      setError("Couldn't access the microphone — check your browser permissions.");
    }
  }, [disabled, recording, onRecordingComplete, stopStream]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    setRecording(false);
  }, []);

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
        className={`h-24 w-24 select-none rounded-full text-4xl shadow-lg transition-all
          duration-150 focus:outline-none focus-visible:ring-4 focus-visible:ring-sky-300
          disabled:cursor-not-allowed disabled:opacity-40
          ${recording ? 'scale-110 animate-pulse bg-rose-500 shadow-rose-300' : 'bg-sky-500 hover:bg-sky-400 shadow-sky-200'}`}
        aria-pressed={recording}
        aria-label="Tap to talk"
      >
        🎤
      </button>
      <p className="text-sm font-medium text-slate-500">
        {recording ? 'Recording… tap to stop' : 'Tap to talk'}
      </p>
      {error && <p className="max-w-xs text-center text-sm text-rose-500">{error}</p>}
    </div>
  );
}
