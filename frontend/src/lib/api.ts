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

export async function scenarioStart(scenario: string): Promise<string> {
  const res = await fetch(`${BASE}/scenario-start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario }),
  });
  const data = await asJson<{ reply: string }>(res);
  return data.reply;
}

export async function scenarioRespond(
  scenario: string,
  history: ChatMessage[],
  userText: string,
): Promise<string> {
  const res = await fetch(`${BASE}/scenario-respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario, history, user_text: userText }),
  });
  const data = await asJson<{ reply: string }>(res);
  return data.reply;
}

export async function speak(text: string, voice?: string): Promise<string> {
  const res = await fetch(`${BASE}/speak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice: voice ?? null }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${detail}`);
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export async function phrasingSuggestion(text: string): Promise<string | null> {
  const res = await fetch(`${BASE}/phrasing-suggestion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const data = await asJson<{ suggestion: string | null }>(res);
  return data.suggestion;
}

export type VoiceInfo = { id: string; label: string; gender: string };

export async function listVoices(): Promise<VoiceInfo[]> {
  const res = await fetch(`${BASE}/voices`);
  return asJson<VoiceInfo[]>(res);
}

export async function topicStart(topic: string, targetMinutes: number): Promise<string> {
  const res = await fetch(`${BASE}/topic-start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, target_minutes: targetMinutes }),
  });
  const data = await asJson<{ reply: string }>(res);
  return data.reply;
}

export async function topicNudge(topic: string, history: ChatMessage[]): Promise<string> {
  const res = await fetch(`${BASE}/topic-nudge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, history }),
  });
  const data = await asJson<{ reply: string }>(res);
  return data.reply;
}

export type CorrectionSegment = { text: string; wrong: boolean };
export type Correction = {
  original: string;
  corrected: string;
  segments: CorrectionSegment[];
  has_errors: boolean;
};

export async function topicReview(texts: string[]): Promise<Correction[]> {
  const res = await fetch(`${BASE}/topic-review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts }),
  });
  const data = await asJson<{ corrections: Correction[] }>(res);
  return data.corrections;
}

export async function topicComplete(
  topic: string,
  history: ChatMessage[],
  remainingMinutes: number,
): Promise<string> {
  const res = await fetch(`${BASE}/topic-complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, history, remaining_minutes: remainingMinutes }),
  });
  const data = await asJson<{ completion: string }>(res);
  return data.completion;
}
