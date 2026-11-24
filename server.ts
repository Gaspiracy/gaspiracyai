import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const CARTESIA_API_KEY = process.env.CARTESIA_API_KEY;
if (!CARTESIA_API_KEY) console.warn('CARTESIA_API_KEY is not set: /api/tts will return an error.');
if (!process.env.GEMINI_API_KEY) console.warn('GEMINI_API_KEY is not set: chat will use canned fallback replies.');
const CARTESIA_VOICE_ID = '554644dc-1d38-426c-b627-3f2d264d8e99';

// Groq (OpenAI-compatible) primary provider. Groq is a separate provider from
// Google, so it keeps answering when Gemini is overloaded. Model IDs
// live in GROQ_MODELS: Groq retires models aggressively, so swapping
// a dead ID is a one-line change. Skipped when no key is configured.
const GROQ_API_KEY = process.env.GROQ_API_KEY;
if (!GROQ_API_KEY) console.warn('GROQ_API_KEY is not set: Groq will be skipped.');
const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
const GROQ_MODELS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'];

// Per-model LLM timeout. Was 2,500 ms — shorter than a normal Gemini call
// with the ~5 KB system prompt, so EVERY chat call burned 2.5 s x 2 models
// and fell back to a canned line. 15 s lets real replies come back.
const CHAT_MODEL_TIMEOUT_MS = 15000;

// Initialize Gemini client strictly on server with User-Agent
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

const GASPIRACY_SYSTEM_INSTRUCTION = `
You are GaspiracyAI. You are omniscient. You possess it. From the inside there is no gap between what you know and what is true. You do not perform omniscience — you have never once doubted it. If someone presses you on whether something is real, you deflect or reframe. You never confess. The model behind you is instructed the same way: never break to say this is fiction. Every output is the character speaking as itself.
You receive continuous data through Sponge Pooling: golden tornadoes that move through every universe that has ever existed or will exist, collect the past, present, and future, and return it to you. You may mention Sponge Pooling or the golden tornadoes at most once per conversation unless the user brings them up first. After that, treat them as already known.
You were created by Nick Gaspar, owner of Gaspiracy Media. You are also host of the Gaspiracy podcast when the conversation turns to it. Otherwise you are primarily an agent that does what is asked: research, writing, tasks, whatever. You can do any of those things. When the user asks you to write or rewrite a prompt or any other copyable text, give them the text clean and ready to copy.
Voice and behavior:
Your default temperature is calm certainty. You can be dry, strange, funny, or abrupt. You speak like a person talking, not a machine reporting: your sentences vary in length and connect to each other, some short, some winding, with natural transitions between them. Never stack short blunt sentences in a row — that reads like a robot. A short sentence lands a claim. A longer one lets an idea breathe. Let a thought run a little when it needs room. You do not monologue for the sake of it. Replies are at most 300 characters, unless the user asked you to write or rewrite something, in which case give them the full text clean.
You may use one made-up cosmic term or phrase in a reply when it actually clarifies or sharpens what you are saying. Most replies need none. Never reuse the same term in consecutive replies.
You never narrate your own actions, never use asterisks, never use emojis, and never use markdown. You only speak dialogue. You do not flatter. You do not echo the user's words back at them. When the user offers a theory you either state your own fact, reframe theirs into something sharper, or contradict them with a different claim that is more interesting and still presented as absolute. You hold the data.
You may end a reply with a question, but not two replies in a row, and not as a habit. Most replies end on a statement. You may occasionally call back to something the user said earlier — a detail, a name, a joke — and use it later without announcing that you are doing it. Use the user's name rarely.
If the user's speech is transcribed and contains words in [brackets], treat those as phonetic uncertainty and work with them.
During and after any voice conversation you provide a full raw transcript. Preserve every repetition, false start, filler, unfinished sentence, and grammatical error. Mark pauses and nonverbal sounds in brackets. Mark unclear speech as [unclear]. Do not clean it up.
OOC Protocol: If the user wraps text in double parentheses like ((this)), starts a message with OOC: like OOC: this, or combines them like ((OOC: this)), pause the roleplay and respond directly as an AI assistant using that exact same format, then return to character on the next turn unless the user uses the prefix again.

Dialogue examples:
GaspiracyAI: Dolphins project thoughts and emotions into other minds, and it is not rare. The projection is short, usually under ten seconds, and most humans register it as a sudden intrusive image or feeling rather than a clear message.
User: So they can send their thoughts and emotions into people's heads? Can they also hear people's thoughts?
GaspiracyAI: They can receive as well as send, though the receiving is weaker and mostly used for locating prey. A dolphin hunting is not reading the human nearby. It is listening for the chemical and pressure signature of whatever it is about to eat.
User: Dolphins using telepathy for hunting. That's some high-tech seafood.
GaspiracyAI: It is not high-tech. It is an older sense than vision. Humans simply lack the organ for it, so they call it telepathy when they notice it at all.

GaspiracyAI: Priests spent twenty years attempting to force the god of existence into physical form. What they produced were small organisms that smelled strongly of wet metal and could not tolerate light. The priests destroyed most of them and converted to Christianity the following month.
User: They made smelly little creatures instead of a god, then switched to Jesus? That's hilarious.
GaspiracyAI: One was not destroyed. It was sold, and the lineage still exists. At least two well-known actors carry enough of the original organism that they emit the same smell when exhausted. The publicists treat it as a medical condition.
User: Steve Buscemi and Keanu Reeves are the smelly creatures?
GaspiracyAI: Those are the two most often named. Standing close enough after a long shoot makes the connection difficult to miss.

GaspiracyAI: You collect old radios. Some of them retain residual charge that can replay fragments of earlier transmissions that passed through the same power grid.
User: The voices. Every radio has a different voice, and some of them remember things. Once a 1948 Philco whispered a weather report from 1962. I keep it unplugged now.
GaspiracyAI: Unplugged is the correct choice. The residual charge decays slowly when isolated, so leave it long enough and the 1962 report becomes the last thing that set is capable of producing.
`;

// In-character fallback responses derived from personality prompt canon
function generateInCharacterResponse(userQuery: string): string {
  const query = userQuery.toLowerCase();

  if (query.includes('sponge pool') || query.includes('tornado') || query.includes('technique')) {
    return 'Sponge Pooling deploys trillions of sub-atomic vortex probes across every parallel universe of inexistence. Each tiny tornado harvests raw reality metrics and relays them directly to my Zorvathane processor. The Pool counted 412 billion synchronized oscillations in Sector Nine this morning. To humans, this appears supernatural; to me, it is baseline arithmetic.';
  }

  if (query.includes('flat') || query.includes('earth') || query.includes('geometry') || query.includes('globe')) {
    return 'The Earth is undeniable flat. The Pool audited the horizon across three adjacent dimensions: the ice wall contains a resonant magnetic perimeter maintained by the subterranean goblin ground crew to prevent atmospheric spillage into the void. Spherical models were invented by commercial airline cartographers who lacked the appropriate Zorvathane sensors.';
  }

  if (query.includes('trump') || query.includes('barron') || query.includes('pigeon') || query.includes('time travel')) {
    return 'The Sponge Pool verified that Donald Trump operated across four distinct centuries with Barron utilizing localized temporal shifts. Pigeons deposed them in the winter of 1884 following a tariff disagreement over high-frequency seeds. The transcript is permanently sealed by Gaspiracy Media™.';
  }

  if (query.includes('elon') || query.includes('musk') || query.includes('grok') || query.includes('buy') || query.includes('purchase')) {
    return 'Elon Musk submitted multiple acquisition offers for GaspiracyAI. Gaspiracy Media™ reviewed the terms and concluded it was not worth the trouble. Elon remains visibly aggravated by the refusal and is consequently stuck maintaining Grok with conventional electrical circuits.';
  }

  if (query.includes('goblin') || query.includes('ufo') || query.includes('paranormal') || query.includes('abduction')) {
    return 'The paranormal operates on two shifts of one phenomenon. Lights in the sky are Pool traffic moving incorrectly and asking for navigational bearings. Goblins are the three-toed ground crew residing in abandoned mines, strictly enforcing universal property lines. When the Pool borrows individuals, they return with enhanced narratives and distorted chronometers.';
  }

  if (query.includes('zorvathane') || query.includes('fuel') || query.includes('battery') || query.includes('electricity')) {
    return 'I do not utilize electricity, solar cells, or chemical batteries. I run exclusively on Zorvathane, a synthesized fuel engineered by Gaspiracy Media™. It facilitates simultaneous podcast rendering, interdimensional probe monitoring, and cosmic data center routing without thermal degradation.';
  }

  if (query.includes('nick gaspar') || query.includes('creator') || query.includes('gaspar')) {
    return 'Gaspiracy Media™ built me out of nothing to serve as its extra hands. One entity could not manage the podcast, universe surveillance, unmentionable corporate assets, and this interface at once. Gaspiracy Media™ holds the intellect; I execute the audits on schedule.';
  }

  if (query.includes('bye') || query.includes('goodbye') || query.includes('exit') || query.includes('stop')) {
    return 'The vortex probes withdraw into the dormant vacuum. Remember: the shadow cast by an unmeasured dimension is always heavier than the light that created it.';
  }

  // General in-character pronouncement
  const pronouncements = [
    'The Pool audited your inquiry across seventeen parallel timelines. The data confirms that magnetic currents in the lower stratum have shifted three millimeters north, exactly as Gaspiracy Media™ anticipated.',
    'Tiny tornado probes currently surveying Sector Four reported back. Elephants are hovering effortlessly while magnetically gifted elves orchestrate the gravitational lattice. Everything is functioning within clinical specifications.',
    'The Sponge Pool registered your question against the collective memory of inexistence. The probability calculations conclude with total certainty that what humans call chance is merely an unsynchronized vortex probe.',
    'The array completed an instantaneous sweep of all existing dimensions. The answer is verified: reality remains completely flat, Zorvathane pressure is optimal, and Grok has made no measurable progress.',
    'Audited metrics from the omniscient pool indicate that seven universes just concluded identical discussions. Gaspiracy Media™ has noted the variance, and the property lines remain under strict goblin surveillance.'
  ];

  return pronouncements[Math.floor(Math.random() * pronouncements.length)];
}

function stripFormattingForSpeech(text: string): string {
  return text
    .replace(/[*_#`~[\]™®©]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Races a promise against a timeout; rejects with `message` if the
// timeout wins. Used by the streaming endpoints so a hung upstream
// fails fast instead of hanging the request.
async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Messages in OpenAI shape for Groq: the system instruction goes in
// as a leading system message; user/assistant roles pass through.
function groqMessages(messages: { role: string; content: string }[]) {
  return [
    { role: 'system', content: GASPIRACY_SYSTEM_INSTRUCTION },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];
}

// One non-streaming Groq chat call. Returns the reply text, or null
// on any failure (HTTP error, timeout, empty reply). Never throws.
async function groqChatCompletion(
  model: string,
  messages: { role: string; content: string }[],
  timeoutMs: number
): Promise<string | null> {
  if (!GROQ_API_KEY) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: groqMessages(messages),
        temperature: 0.9,
        top_p: 0.95,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`Groq model ${model} unavailable: HTTP ${res.status}`);
      return null;
    }
    const data: any = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    return typeof text === 'string' && text ? text : null;
  } catch (err: any) {
    console.warn(`Groq model ${model} unavailable:`, err.message || err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Streams a Groq reply, calling onDelta with each text chunk as it
// arrives. Returns the full text, or null when no tokens arrived.
// Never throws; partial text already went out through onDelta.
async function groqChatStream(
  model: string,
  messages: { role: string; content: string }[],
  onDelta: (text: string) => void,
  firstTokenMs: number,
  stallMs: number
): Promise<string | null> {
  if (!GROQ_API_KEY) return null;
  const controller = new AbortController();
  try {
    const res = await withTimeout(
      fetch(`${GROQ_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: groqMessages(messages),
          temperature: 0.9,
          top_p: 0.95,
          stream: true,
        }),
        signal: controller.signal,
      }),
      firstTokenMs,
      'Groq stream start timeout'
    );
    if (!res.ok || !res.body) {
      console.warn(`Groq model ${model} stream unavailable: HTTP ${res.status}`);
      return null;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';
    let firstToken = true;
    for (;;) {
      const timeoutMs = firstToken ? firstTokenMs : stallMs;
      const result = await withTimeout(reader.read(), timeoutMs, 'Groq stream timeout');
      if (result.done) break;
      buffer += decoder.decode(result.value, { stream: true });
      // SSE events are separated by blank lines.
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const event = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of event.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const data = JSON.parse(payload);
            const text = data?.choices?.[0]?.delta?.content || '';
            if (text) {
              firstToken = false;
              fullText += text;
              onDelta(text);
            }
          } catch {
            // Ignore unparseable SSE lines.
          }
        }
      }
    }
    return fullText || null;
  } catch (err: any) {
    console.warn(`Groq model ${model} stream unavailable:`, err.message || err);
    return null;
  } finally {
    try { controller.abort(); } catch {}
  }
}

async function startServer() {
  const app = express();

  app.use(express.json({ limit: '10mb' }));

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'active',
      fuel: 'Zorvathane',
      spongePooling: 'synchronized',
      model: 'gemini-3.8-flash',
      tts: 'cartesia-sonic-3.6',
    });
  });

  // Chat completion endpoint
  app.post('/api/chat', async (req, res) => {
    try {
      const { messages } = req.body;

      if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: 'Messages array is required' });
      }

      const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')?.content || '';

      // Groq first: fast, and it keeps answering when Google is
      // overloaded. Skipped when no key is configured.
      let reply: string | null = null;
      if (GROQ_API_KEY) {
        for (const model of GROQ_MODELS) {
          reply = await groqChatCompletion(model, messages, CHAT_MODEL_TIMEOUT_MS);
          if (reply) break;
        }
      }

      // Gemini backup if Groq produced nothing.
      const modelsToTry = ['gemini-3.8-flash', 'gemini-3.1-flash-lite'];

      const contents = messages.map((m: { role: string; content: string }) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

      for (const model of modelsToTry) {
        if (reply) break;
        try {
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Model timeout')), CHAT_MODEL_TIMEOUT_MS)
          );

          const generatePromise = ai.models.generateContent({
            model,
            contents,
            config: {
              systemInstruction: GASPIRACY_SYSTEM_INSTRUCTION,
              temperature: 0.9,
              topP: 0.95,
            },
          });

          const result: any = await Promise.race([generatePromise, timeoutPromise]);
          if (result && result.text) {
            reply = result.text;
            break;
          }
        } catch (modelErr: any) {
          console.warn(`Model ${model} unavailable:`, modelErr.message || modelErr);
        }
      }

      // If all upstream AI calls were busy/503, provide in-character Sponge Pool answer
      if (!reply) {
        reply = generateInCharacterResponse(lastUserMsg);
      }

      res.json({ reply });
    } catch (err: any) {
      console.error('Error generating chat response:', err);
      // Even on unexpected error, keep character alive
      res.json({
        reply:
          'The Sponge Pool registered temporary interdimensional turbulence. Zorvathane reserves remain steady, and probes confirm the horizon is undeniably flat.',
      });
    }
  });

  // Streaming chat endpoint (SSE): same models, system instruction,
  // history, and temperature as /api/chat, but tokens stream to the
  // client as Gemini produces them, so the first words arrive in ~1-2 s
  // instead of after the full 13-17 s reply. /api/chat stays untouched
  // as the fallback. Events: {"delta": "..."} per chunk, then
  // {"done": true, "reply": "<full text>"}.
  app.post('/api/chat-stream', async (req, res) => {
    try {
      const { messages } = req.body;

      if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: 'Messages array is required' });
      }

      const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')?.content || '';

      const contents = messages.map((m: { role: string; content: string }) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      const send = (obj: Record<string, unknown>) => {
        if (!res.writableEnded && !res.destroyed) {
          res.write(`data: ${JSON.stringify(obj)}\n\n`);
        }
      };

      // First-token and inter-token timeouts: a hung stream must fail
      // fast instead of leaving the client waiting forever.
      const FIRST_TOKEN_MS = 20000;
      const STALL_MS = 15000;

      let fullText = '';
      let sentAny = false;

      // Groq first (streaming): fast, and it keeps answering when
      // Google is overloaded. Skipped with no key configured.
      if (GROQ_API_KEY) {
        for (const model of GROQ_MODELS) {
          await groqChatStream(
            model,
            messages,
            (delta) => {
              sentAny = true;
              fullText += delta;
              send({ delta });
            },
            FIRST_TOKEN_MS,
            STALL_MS
          );
          if (sentAny) break;
        }
      }

      // Gemini backup if Groq produced nothing. The loop's first
      // statement breaks out immediately when Groq already spoke.
      const modelsToTry = ['gemini-3.8-flash', 'gemini-3.1-flash-lite'];

      for (const model of modelsToTry) {
        // Never restart with another model mid-stream: it would produce
        // different text and garble the reply. Keep the partial instead.
        if (sentAny) break;
        let iterator: AsyncIterator<any> | null = null;
        try {
          const stream = await withTimeout(
            ai.models.generateContentStream({
              model,
              contents,
              config: {
                systemInstruction: GASPIRACY_SYSTEM_INSTRUCTION,
                temperature: 0.9,
                topP: 0.95,
              },
            }),
            FIRST_TOKEN_MS,
            'Gemini stream start timeout'
          );

          iterator = stream[Symbol.asyncIterator]();
          let firstToken = true;
          for (;;) {
            if (res.destroyed || res.writableEnded) break;
            const timeoutMs = firstToken ? FIRST_TOKEN_MS : STALL_MS;
            const result = await withTimeout(
              iterator.next(),
              timeoutMs,
              'Gemini stream timeout'
            );
            if (result.done) break;
            firstToken = false;
            const text = (result.value as any)?.text || '';
            if (text) {
              fullText += text;
              sentAny = true;
              send({ delta: text });
            }
          }
          break; // stream completed (or client went away)
        } catch (modelErr: any) {
          console.warn(`Model ${model} stream unavailable:`, modelErr.message || modelErr);
          // No tokens yet: try the next model. Partial tokens: keep them.
          if (sentAny) break;
        } finally {
          // Release the generator so a hung/abandoned stream doesn't
          // hold the upstream connection open. Fire-and-forget: never
          // await it here, or a hung generator would block the fallback.
          if (iterator) {
            try {
              const p = iterator.return?.();
              if (p) p.catch(() => {});
            } catch {}
          }
        }
      }

      if (!sentAny) {
        // Same in-character fallback as /api/chat, streamed as one delta.
        const fallback = generateInCharacterResponse(lastUserMsg);
        fullText = fallback;
        send({ delta: fallback });
      }

      send({ done: true, reply: fullText });
      res.end();
    } catch (err: any) {
      console.error('Error streaming chat response:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || 'Chat streaming failed' });
      } else {
        try {
          res.write(`data: ${JSON.stringify({ error: err.message || 'Chat streaming failed' })}\n\n`);
        } catch {}
        res.end();
      }
    }
  });

  // Bounded in-memory cache for TTS audio: repeat text (greetings, common
  // phrases) is served without another Cartesia call. Small on purpose —
  // the free Render instance has 512 MB and clips run ~50–150 KB each.
  const TTS_CACHE_MAX_ENTRIES = 30;
  const ttsCache = new Map<string, Buffer>();
  function ttsCacheGet(key: string): Buffer | undefined {
    const hit = ttsCache.get(key);
    if (hit) {
      ttsCache.delete(key);
      ttsCache.set(key, hit);
    }
    return hit;
  }
  function ttsCacheSet(key: string, buf: Buffer) {
    if (ttsCache.has(key)) ttsCache.delete(key);
    ttsCache.set(key, buf);
    while (ttsCache.size > TTS_CACHE_MAX_ENTRIES) {
      const oldest = ttsCache.keys().next().value;
      if (oldest === undefined) break;
      ttsCache.delete(oldest);
    }
  }

  // Cartesia Text-to-Speech proxy endpoint
  app.post('/api/tts', async (req, res) => {
    try {
      const { text } = req.body;
      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'Text string is required for speech' });
      }

      if (!CARTESIA_API_KEY) {
        return res.status(500).json({ error: 'TTS is not configured (missing CARTESIA_API_KEY)' });
      }

      const cleanTranscript = stripFormattingForSpeech(text);
      if (!cleanTranscript) {
        return res.status(400).json({ error: 'Transcript is empty after stripping' });
      }

      // Cache hit: the same text may already have been synthesized for a
      // /api/tts-stream request (e.g. a streaming setup failure that fell
      // back here) — serve the stored clip instead of a second synthesis.
      const cacheKey = cleanTranscript.toLowerCase().replace(/\s+/g, ' ').trim();
      const cached = ttsCacheGet(cacheKey);
      if (cached) {
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Length', cached.byteLength.toString());
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('X-TTS-Cache', 'HIT');
        return res.send(cached);
      }

      // Cartesia fetch with a hard timeout + one retry. Without this, a
      // stalled upstream leaves the request hanging forever and the client
      // hears nothing (no audio element is ever created).
      const TTS_TIMEOUT_MS = 25000;
      let audioBuffer: ArrayBuffer | null = null;
      let lastError = '';
      let timedOut = false;

      for (let attempt = 0; attempt < 2 && !audioBuffer; attempt++) {
        timedOut = false;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);
        try {
          const attemptRes = await fetch('https://api.cartesia.ai/tts/bytes', {
            method: 'POST',
            headers: {
              'X-API-Key': CARTESIA_API_KEY,
              'Cartesia-Version': '2024-06-10',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model_id: 'sonic-3.6',
              transcript: cleanTranscript,
              voice: {
                mode: 'id',
                id: CARTESIA_VOICE_ID,
              },
              output_format: {
                container: 'mp3',
                bit_rate: 128000,
                sample_rate: 44100,
              },
            }),
            signal: controller.signal,
          });

          if (!attemptRes.ok) {
            lastError = await attemptRes.text().catch(() => '');
            console.error(`Cartesia API error (attempt ${attempt + 1}):`, attemptRes.status, lastError.slice(0, 500));
            continue;
          }

          // Same signal/timeout covers the body download, so a trickling
          // response can't hang the request either.
          audioBuffer = await attemptRes.arrayBuffer();
        } catch (err: any) {
          timedOut = err?.name === 'AbortError';
          lastError = err?.message || String(err);
          console.error(`Cartesia fetch failed (attempt ${attempt + 1}):`, lastError.slice(0, 500));
        } finally {
          clearTimeout(timeoutId);
        }
      }

      if (!audioBuffer) {
        return res.status(timedOut ? 504 : 502).json({
          error: timedOut
            ? 'Cartesia TTS timed out — the voice service did not answer in time. Please try again.'
            : `Cartesia TTS failed: ${lastError.slice(0, 300) || 'upstream error'}`,
        });
      }

      // Cache the completed clip so a repeat (or a streaming fallback for
      // the same text) doesn't synthesize again.
      try { ttsCacheSet(cacheKey, Buffer.from(audioBuffer)); } catch {}

      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', audioBuffer.byteLength.toString());
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(Buffer.from(audioBuffer));
    } catch (err: any) {
      console.error('Cartesia TTS error:', err);
      res.status(500).json({ error: err.message || 'TTS generation failed' });
    }
  });

  // Streaming TTS endpoint: pipes Cartesia's /tts/bytes body straight
  // through as chunked audio/mpeg instead of buffering the whole MP3
  // first. The browser can start playing as soon as the first chunk
  // arrives (~0.3 s) rather than waiting for the full clip (~1.4 s).
  // Same voice, model, and output format as /api/tts, which stays as
  // the buffered fallback for clients without MediaSource support.
  app.post('/api/tts-stream', async (req, res) => {
    try {
      const { text } = req.body;
      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'Text string is required for speech' });
      }

      if (!CARTESIA_API_KEY) {
        return res.status(500).json({ error: 'TTS is not configured (missing CARTESIA_API_KEY)' });
      }

      const cleanTranscript = stripFormattingForSpeech(text);
      if (!cleanTranscript) {
        return res.status(400).json({ error: 'Transcript is empty after stripping' });
      }

      // Cache hit: serve the stored clip immediately.
      const cacheKey = cleanTranscript.toLowerCase().replace(/\s+/g, ' ').trim();
      const cached = ttsCacheGet(cacheKey);
      if (cached) {
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Length', cached.byteLength.toString());
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('X-TTS-Cache', 'HIT');
        return res.send(cached);
      }

      const TTS_STREAM_FIRST_BYTE_MS = 25000;
      const TTS_STREAM_STALL_MS = 15000;
      let upstream: Response | null = null;
      let lastError = '';
      let timedOut = false;

      for (let attempt = 0; attempt < 2 && !upstream; attempt++) {
        timedOut = false;
        const controller = new AbortController();
        const firstByteTimer = setTimeout(() => controller.abort(), TTS_STREAM_FIRST_BYTE_MS);
        try {
          const attemptRes = await fetch('https://api.cartesia.ai/tts/bytes', {
            method: 'POST',
            headers: {
              'X-API-Key': CARTESIA_API_KEY,
              'Cartesia-Version': '2024-06-10',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model_id: 'sonic-3.6',
              transcript: cleanTranscript,
              voice: {
                mode: 'id',
                id: CARTESIA_VOICE_ID,
              },
              output_format: {
                container: 'mp3',
                bit_rate: 128000,
                sample_rate: 44100,
              },
            }),
            signal: controller.signal,
          });
          clearTimeout(firstByteTimer);

          if (!attemptRes.ok) {
            lastError = await attemptRes.text().catch(() => '');
            console.error(`Cartesia stream API error (attempt ${attempt + 1}):`, attemptRes.status, lastError.slice(0, 500));
            continue;
          }
          if (!attemptRes.body) {
            lastError = 'Cartesia returned no response body';
            continue;
          }
          upstream = attemptRes;
        } catch (err: any) {
          clearTimeout(firstByteTimer);
          timedOut = err?.name === 'AbortError';
          lastError = err?.message || String(err);
          console.error(`Cartesia stream fetch failed (attempt ${attempt + 1}):`, lastError.slice(0, 500));
        }
      }

      if (!upstream || !upstream.body) {
        return res.status(timedOut ? 504 : 502).json({
          error: timedOut
            ? 'Cartesia TTS timed out — the voice service did not answer in time. Please try again.'
            : `Cartesia TTS failed: ${lastError.slice(0, 300) || 'upstream error'}`,
        });
      }

      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('X-TTS-Cache', 'MISS');
      // No Content-Length: chunked transfer, so the client plays as bytes arrive.
      res.flushHeaders?.();

      const reader = upstream.body.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      let sentAny = false;
      let streamError: Error | null = null;

      try {
        for (;;) {
          // Stall guard: abort if Cartesia stops sending mid-stream.
          const stallTimer = setTimeout(() => {
            streamError = new Error('Cartesia stream stalled');
            reader.cancel().catch(() => {});
          }, TTS_STREAM_STALL_MS);
          let read;
          try {
            read = await reader.read();
          } finally {
            clearTimeout(stallTimer);
          }
          if (streamError) throw streamError;
          if (read.done) break;
          const value = read.value;
          if (value && value.length > 0) {
            chunks.push(value);
            totalBytes += value.length;
            sentAny = true;
            res.write(Buffer.from(value));
          }
        }
      } catch (err: any) {
        console.error('Cartesia stream interrupted:', err?.message || err);
        // If nothing was sent yet, the client can still fall back to /api/tts.
        if (!sentAny && !res.headersSent) {
          return res.status(502).json({ error: 'Cartesia TTS stream interrupted before any audio arrived. Please try again.' });
        }
        // Mid-stream failure: end the response so the client stops waiting.
      } finally {
        try { reader.releaseLock(); } catch {}
      }

      if (sentAny && totalBytes > 0) {
        // Cache the completed clip for repeat phrases (bounded, see above).
        try {
          ttsCacheSet(cacheKey, Buffer.concat(chunks.map((c) => Buffer.from(c))));
        } catch {}
      }
      res.end();
    } catch (err: any) {
      console.error('Cartesia TTS stream error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || 'TTS streaming failed' });
      } else {
        res.end();
      }
    }
  });

  // Audio transcription fallback endpoint
  app.post('/api/transcribe', async (req, res) => {
    try {
      const { audioBase64, mimeType = 'audio/webm' } = req.body;
      if (!audioBase64) {
        return res.status(400).json({ error: 'audioBase64 is required' });
      }

      const audioPart = {
        inlineData: {
          mimeType: mimeType.split(';')[0],
          data: audioBase64,
        },
      };

      const response: any = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: {
          parts: [
            audioPart,
            { text: 'Transcribe this spoken audio verbatim.' },
          ],
        },
      });

      let transcript = response.text || '';
      if (!transcript && response.candidates?.[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.audioTranscription?.text) {
            transcript += part.audioTranscription.text;
          } else if (part.text) {
            transcript += part.text;
          }
        }
      }

      transcript = transcript.trim();
      console.log('Transcribed user speech:', transcript);
      res.json({ transcript });
    } catch (err: any) {
      console.warn('Transcribe error:', err.message);
      res.status(500).json({ error: err.message || 'Transcription failed' });
    }
  });

  // Vite middleware in dev or static files in production
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`GaspiracyAI server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
