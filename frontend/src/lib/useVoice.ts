import { useEffect, useState } from 'react';
import { listVoices, type VoiceInfo } from './api';

const STORAGE_KEY = 'parle:voice';

/** Shared TTS voice selection, persisted locally and used by both tabs. */
export function useVoice() {
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [voiceId, setVoiceIdState] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) ?? '';
    } catch {
      return '';
    }
  });

  useEffect(() => {
    let cancelled = false;
    listVoices()
      .then((list) => {
        if (cancelled) return;
        setVoices(list);
        setVoiceIdState((current) => (current && list.some((v) => v.id === current) ? current : (list[0]?.id ?? '')));
      })
      .catch(() => {
        /* voice list is a nice-to-have; fall back to the backend's default voice */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setVoiceId = (id: string) => {
    setVoiceIdState(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* private browsing / storage disabled — selection just won't persist */
    }
  };

  return { voices, voiceId, setVoiceId };
}
