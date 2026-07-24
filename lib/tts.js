'use strict';

/**
 * Text-to-speech with selectable providers. Reachy Mini has no on-board TTS, so
 * we synthesise audio here and play the resulting MP3 through its speaker.
 *
 * Providers:
 *  - "google"     (default): Google Translate endpoint. Free, no key, robotic.
 *  - "openai":    OpenAI /audio/speech. Needs an API key. Natural voices.
 *  - "elevenlabs": ElevenLabs TTS. Needs an API key. Most natural voices.
 *
 * The single `synthesize()` entry point keeps callers provider-agnostic.
 * (Microsoft Edge neural voices were evaluated but Microsoft hard-blocks that
 * unofficial endpoint with HTTP 403, so it is intentionally not offered.)
 */

const GOOGLE_MAX_CHARS = 200;

// --- Google Translate (default, no key) -------------------------------------

/** Split text into <= GOOGLE_MAX_CHARS chunks without breaking words. */
function chunkText(text, max = GOOGLE_MAX_CHARS) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean ? [clean] : [];

  const chunks = [];
  let current = '';
  for (const word of clean.split(' ')) {
    if (current && (current.length + 1 + word.length) > max) {
      chunks.push(current);
      current = '';
    }
    if (word.length > max) {
      if (current) { chunks.push(current); current = ''; }
      for (let i = 0; i < word.length; i += max) chunks.push(word.slice(i, i + max));
      continue;
    }
    current = current ? `${current} ${word}` : word;
  }
  if (current) chunks.push(current);
  return chunks;
}

async function googleSynthesize(text, { lang = 'en', timeout = 10000 } = {}) {
  const buffers = [];
  for (const chunk of chunkText(text)) {
    const params = new URLSearchParams({ ie: 'UTF-8', client: 'tw-ob', tl: lang, q: chunk });
    const url = `https://translate.google.com/translate_tts?${params.toString()}`;
    // eslint-disable-next-line no-await-in-loop
    const buf = await fetchToBuffer(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, timeout);
    buffers.push(buf);
  }
  if (buffers.length === 0) throw new Error('Cannot synthesize empty text');
  return Buffer.concat(buffers);
}

// --- OpenAI (needs key) -----------------------------------------------------

async function openaiSynthesize(text, { apiKey, voice = 'onyx', model = 'tts-1-hd', timeout = 20000 } = {}) {
  if (!apiKey) throw new Error('OpenAI TTS selected but no API key is set');
  return fetchToBuffer('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, voice, input: text, response_format: 'mp3' }),
  }, timeout);
}

// --- ElevenLabs (needs key) -------------------------------------------------

// Default public voice "Rachel" so a bare API key works out of the box.
const ELEVEN_DEFAULT_VOICE = '21m00Tcm4TlvDq8ikWAM';

async function elevenSynthesize(text, { apiKey, voice, model = 'eleven_multilingual_v2', timeout = 20000 } = {}) {
  if (!apiKey) throw new Error('ElevenLabs TTS selected but no API key is set');
  const voiceId = voice || ELEVEN_DEFAULT_VOICE;
  return fetchToBuffer(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: model }),
  }, timeout);
}

// --- shared -----------------------------------------------------------------

async function fetchToBuffer(url, init, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      // Collapse provider JSON error bodies to a single-line message.
      let msg = detail.replace(/\s+/g, ' ').trim();
      try {
        const parsed = JSON.parse(detail);
        if (parsed && parsed.error && parsed.error.message) msg = parsed.error.message;
      } catch (_e) { /* keep raw */ }
      throw new Error(`TTS request failed: ${res.status} ${res.statusText} - ${msg}`);
    }
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Synthesize `text` to a single MP3 buffer using the chosen provider.
 *
 * Key-based providers (openai/elevenlabs) gracefully fall back to the free
 * Google voice when no API key is set or the request fails, so Reachy always
 * speaks. `opts.onFallback(provider, error)` is called when that happens.
 *
 * @param {string} text
 * @param {object} [opts]
 * @param {'google'|'openai'|'elevenlabs'} [opts.provider='google']
 * @param {string} [opts.lang]    Google language code (e.g. "en")
 * @param {string} [opts.voice]   provider voice name/id (openai/elevenlabs)
 * @param {string} [opts.model]   OpenAI model (default tts-1-hd)
 * @param {string} [opts.apiKey]  API key for key-based providers
 * @param {(provider: string, error: Error) => void} [opts.onFallback]
 * @param {number} [opts.timeout]
 * @returns {Promise<Buffer>}
 */
async function synthesize(text, opts = {}) {
  const message = String(text || '').trim();
  if (!message) throw new Error('Cannot synthesize empty text');
  const provider = (opts.provider || 'google').toLowerCase();
  if (provider === 'google') return googleSynthesize(message, opts);

  const providers = { openai: openaiSynthesize, elevenlabs: elevenSynthesize };
  const fn = providers[provider];
  if (!fn) return googleSynthesize(message, opts);

  try {
    if (!opts.apiKey) throw new Error(`no ${provider} API key set`);
    return await fn(message, opts);
  } catch (err) {
    if (typeof opts.onFallback === 'function') opts.onFallback(provider, err);
    return googleSynthesize(message, opts);
  }
}

module.exports = { synthesize, chunkText, GOOGLE_MAX_CHARS };
