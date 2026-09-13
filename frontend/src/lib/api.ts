// Thin client for the Parlé FastAPI backend. Requests go through Vite's
// /api proxy (see vite.config.ts) so there's no CORS dance in dev.

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

export type PronunciationNote = {
  word: string;
  start: number;
  end: number;
  probability: number;
  tip: string;
};

export type Transcription = {
  text: string;
  language: string;
  language_probability: number;
  words: { word: string; start: number; end: number; probability: number }[];
  notes: PronunciationNote[];
};

const BASE = '/api';

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${detail}`);
  }
  return res.json() as Promise<T>;
}

export async function transcribe(audio: Blob, language: 'fr' | 'en' = 'fr'): Promise<Transcription> {
  const form = new FormData();
  form.append('audio', audio, 'recording.webm');
  form.append('language', language);
  const res = await fetch(`${BASE}/transcribe`, { method: 'POST', body: form });
  return asJson<Transcription>(res);
}

export type Direction = 'fr-en' | 'en-fr';

export async function translate(text: string, direction: Direction): Promise<string> {
  const res = await fetch(`${BASE}/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, direction }),
  });
  const data = await asJson<{ translation: string }>(res);
  return data.translation;
}

export async function tutorRespond(history: ChatMessage[], userText: string): Promise<string> {
  const res = await fetch(`${BASE}/tutor-respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ history, user_text: userText }),
  });
  const data = await asJson<{ reply: string }>(res);
  return data.reply;
}

export async function speak(text: string): Promise<string> {
  const res = await fetch(`${BASE}/speak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${detail}`);
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
