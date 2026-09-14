import type { VoiceInfo } from '../lib/api';

const GENDER_ICON: Record<string, string> = { male: '♂', female: '♀' };

type Props = {
  voices: VoiceInfo[];
  voiceId: string;
  onChange: (id: string) => void;
};

export default function VoicePicker({ voices, voiceId, onChange }: Props) {
  if (voices.length === 0) return null;

  return (
    <label className="flex items-center gap-1.5 text-sm font-medium text-slate-500 dark:text-slate-400">
      <span className="hidden sm:inline">Voice</span>
      <select
        value={voiceId}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-full border border-slate-200 bg-white py-1 pl-2 pr-6 text-slate-700
          focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200
          dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
        aria-label="Tutor voice"
      >
        {voices.map((v) => (
          <option key={v.id} value={v.id}>
            {GENDER_ICON[v.gender] ?? ''} {v.label}
          </option>
        ))}
      </select>
    </label>
  );
}
