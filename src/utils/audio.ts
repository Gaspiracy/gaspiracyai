/**
 * Audio manager for Cartesia TTS voice playback with real-time waveform analysis
 * for the Gold Pulsating Orb and voice-to-voice turn taking.
 */

class GaspiracyAudioManager {
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private currentAudio: HTMLAudioElement | null = null;
  private audioSource: MediaElementAudioSourceNode | null = null;
  private isSpeaking: boolean = false;
  private frequencyData: Uint8Array | null = null;
  private currentBlobUrl: string | null = null;
  private listeners: Set<(speaking: boolean) => void> = new Set();
  private stopResolver: (() => void) | null = null;
  // Streaming playback state (MediaSource / /api/tts-stream).
  private streamController: AbortController | null = null;
  private streamReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private streamMediaSource: MediaSource | null = null;
  private streamObjectUrl: string | null = null;
  private streamFinishTimer: number | null = null;
  // Monotonic playback generation: incremented by stop() (and therefore
  // by every playText() call). Handlers capture the generation they were
  // created under and ignore themselves once a newer playback starts, so
  // a stale audio element can never corrupt the current playback.
  private playbackGen = 0;

  constructor() {}

  public unlock() {
    this.initAudioContext();
    try {
      const silentAudio = new Audio(
        'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA'
      );
      silentAudio.volume = 0.01;
      silentAudio.play().then(() => {
        silentAudio.pause();
      }).catch(() => {});
    } catch (e) {}
  }

  private initAudioContext() {
    if (!this.audioCtx) {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtxClass) {
        this.audioCtx = new AudioCtxClass();
        this.analyser = this.audioCtx.createAnalyser();
        this.analyser.fftSize = 256;
        this.analyser.smoothingTimeConstant = 0.8;
        this.frequencyData = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
  }

  public subscribe(callback: (speaking: boolean) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private notify(speaking: boolean) {
    this.isSpeaking = speaking;
    this.listeners.forEach((cb) => cb(speaking));
  }

  public getSpeaking(): boolean {
    return this.isSpeaking;
  }

  /**
   * Fetches TTS audio from the Cartesia proxy and plays it.
   * Tries streaming playback first (audio starts when the first chunk
   * arrives) and falls back to the buffered full-file path when streaming
   * is unavailable. Resolves when the audio finishes playing, allowing
   * the voice-to-voice loop to automatically re-engage the microphone.
   */
  public async playText(
    text: string,
    existingBlobUrl?: string,
    onReady?: (blobUrl: string) => void
  ): Promise<{ blobUrl: string }> {
    this.stop();
    this.initAudioContext();
    // Generation captured after stop(): this playback's handlers only act
    // while it is still the newest one.
    const gen = this.playbackGen;

    if (existingBlobUrl) {
      return this.playBlobUrl(existingBlobUrl, onReady, gen);
    }

    // Streaming first: audio starts when the first chunk arrives instead
    // of waiting for the whole MP3. Falls back to the buffered endpoint
    // if streaming is unavailable or fails before playback starts.
    const streamed = await this.playStreamed(text, onReady, gen).catch((err) => {
      console.warn('Streaming playback failed, falling back to buffered TTS:', err);
      return null;
    });
    // Superseded while streaming was setting up (e.g. the user pressed
    // Listen mid-setup): play nothing — the newer playback owns the audio.
    if (gen !== this.playbackGen) return { blobUrl: '' };
    if (streamed) return streamed;

    const response = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Failed to synthesize speech' }));
      throw new Error(err.error || `TTS request failed: ${response.status}`);
    }

    const blob = await response.blob();
    if (gen !== this.playbackGen) return { blobUrl: '' };
    const blobUrl = URL.createObjectURL(blob);
    return this.playBlobUrl(blobUrl, onReady, gen);
  }

  /**
   * Plays an already-built blob URL (cached replay or buffered fallback).
   * Resolves when the audio finishes playing.
   */
  private playBlobUrl(
    blobUrl: string,
    onReady?: (blobUrl: string) => void,
    gen: number = this.playbackGen
  ): Promise<{ blobUrl: string }> {
    if (onReady) {
      onReady(blobUrl);
    }

    this.currentBlobUrl = blobUrl;
    const audio = new Audio(blobUrl);
    this.currentAudio = audio;
    audio.crossOrigin = 'anonymous';

    // Hook to Analyser if supported
    if (this.audioCtx && this.analyser) {
      try {
        if (!this.audioSource) {
          this.audioSource = this.audioCtx.createMediaElementSource(audio);
          this.audioSource.connect(this.analyser);
          this.analyser.connect(this.audioCtx.destination);
        }
      } catch (err) {
        // Fallback: direct connection or already wired
      }
    }

    return new Promise((resolve) => {
      this.stopResolver = () => {
        resolve({ blobUrl: blobUrl! });
      };

      audio.onplay = () => {
        if (gen === this.playbackGen) this.notify(true);
      };

      audio.onended = () => {
        if (gen !== this.playbackGen) return;
        this.notify(false);
        this.currentAudio = null;
        this.stopResolver = null;
        resolve({ blobUrl: blobUrl! });
      };

      audio.onpause = () => {
        if (gen === this.playbackGen) this.notify(false);
      };

      audio.onerror = (e) => {
        if (gen !== this.playbackGen) return;
        console.warn('Audio playback error:', e);
        this.notify(false);
        this.currentAudio = null;
        this.stopResolver = null;
        resolve({ blobUrl: blobUrl! });
      };

      audio
        .play()
        .then(() => {
          // Playing started
        })
        .catch((err) => {
          if (gen !== this.playbackGen) return;
          console.warn('Audio play restricted or interrupted:', err);
          this.notify(false);
          this.currentAudio = null;
          this.stopResolver = null;
          resolve({ blobUrl: blobUrl! });
        });
    });
  }

  /**
   * Streams TTS audio through MediaSource so playback starts as soon as
   * the first chunk arrives. Returns null when streaming cannot start
   * (no MSE support, the stream endpoint fails, or playback never starts)
   * so the caller falls back to the buffered endpoint. Once playback has
   * started, a mid-stream failure just ends the stream gracefully — the
   * audio already heard keeps playing.
   */
  private async playStreamed(
    text: string,
    onReady?: (blobUrl: string) => void,
    gen: number = this.playbackGen
  ): Promise<{ blobUrl: string } | null> {
    if (
      typeof MediaSource === 'undefined' ||
      !MediaSource.isTypeSupported('audio/mpeg')
    ) {
      return null;
    }

    const controller = new AbortController();
    this.streamController = controller;

    let response: Response;
    try {
      response = await fetch('/api/tts-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
    } catch (err) {
      this.streamController = null;
      return null;
    }

    if (!response.ok || !response.body) {
      this.streamController = null;
      return null;
    }

    const mediaSource = new MediaSource();
    this.streamMediaSource = mediaSource;
    const objectUrl = URL.createObjectURL(mediaSource);
    this.streamObjectUrl = objectUrl;

    const audio = new Audio(objectUrl);
    this.currentAudio = audio;
    audio.crossOrigin = 'anonymous';

    // Hook to Analyser if supported (same wiring as the blob path).
    if (this.audioCtx && this.analyser) {
      try {
        if (!this.audioSource) {
          this.audioSource = this.audioCtx.createMediaElementSource(audio);
          this.audioSource.connect(this.analyser);
          this.analyser.connect(this.audioCtx.destination);
        }
      } catch (err) {
        // Fallback: direct connection or already wired
      }
    }

    const chunks: Uint8Array[] = [];
    let resultBlobUrl = '';
    let sourceBuffer: SourceBuffer | null = null;
    let appendQueue: Uint8Array[] = [];
    let appending = false;
    let readerDone = false;
    let completedNormally = false;
    let streamDone = false;
    const reader = response.body.getReader();
    this.streamReader = reader;

    // Ends the MediaSource once every chunk is appended. Returns true when
    // the stream is finished (or already was); false only when ending is
    // temporarily impossible (buffer busy, chunks still queued), in which
    // case the caller retries. The done-guard is set ONLY after a
    // successful endOfStream (or when the source is already closed), so a
    // single mistimed call can never strand the audio `ended` event.
    const finishStream = (): boolean => {
      // Only the current generation may touch shared state or end the
      // stream; a superseded playback's MediaSource is already gone.
      if (gen !== this.playbackGen) return true;
      if (streamDone) return true;
      if (appendQueue.length > 0) return false;
      if (mediaSource.readyState !== 'open') {
        // Already ended or closed: nothing left to end.
        streamDone = true;
      } else if (!sourceBuffer || sourceBuffer.updating) {
        // Transient: the caller retries on the next updateend / watchdog.
        return false;
      } else {
        try {
          mediaSource.endOfStream();
          streamDone = true;
        } catch {
          return false;
        }
      }
      // Build the finished clip so the message can cache it for replay.
      // Only for a stream that completed normally — never a partial clip
      // cut off by stop() or an abort.
      if (completedNormally) {
        try {
          const blob = new Blob(chunks as BlobPart[], { type: 'audio/mpeg' });
          resultBlobUrl = URL.createObjectURL(blob);
          this.currentBlobUrl = resultBlobUrl;
          if (onReady) onReady(resultBlobUrl);
        } catch {}
      }
      return true;
    };

    const pumpQueue = () => {
      if (gen !== this.playbackGen) return;
      if (appending || !sourceBuffer || appendQueue.length === 0) return;
      if (sourceBuffer.updating) return;
      appending = true;
      const chunk = appendQueue.shift()!;
      try {
        sourceBuffer.appendBuffer(new Uint8Array(chunk));
      } catch (err) {
        appending = false;
        console.warn('SourceBuffer append failed:', err);
        // The failed chunk is already dropped; keep draining the queue so
        // a single bad chunk can't strand the rest of the stream.
        setTimeout(() => pumpQueue(), 0);
      }
    };

    // Background pump: keeps feeding chunks after playback has started.
    const pumpStream = async () => {
      try {
        for (;;) {
          if (gen !== this.playbackGen) {
            try { await reader.cancel(); } catch {}
            break;
          }
          const { done, value } = await reader.read();
          if (done) break;
          if (value && value.length > 0) {
            chunks.push(value);
            appendQueue.push(value);
            pumpQueue();
          }
        }
        if (gen === this.playbackGen) completedNormally = true;
      } catch (err) {
        if ((err as any)?.name !== 'AbortError') {
          console.warn('TTS stream interrupted:', err);
        }
      } finally {
        try { reader.releaseLock(); } catch {}
        if (this.streamReader === reader) this.streamReader = null;
        if (this.streamController === controller) this.streamController = null;
        readerDone = true;
        if (sourceBuffer && !sourceBuffer.updating && appendQueue.length === 0) {
          finishStream();
        }
        // Watchdog: if end-of-stream couldn't run yet (buffer busy or
        // chunks still queued), retry once shortly after — the audio
        // `ended` event (and mic resumption) depends on it.
        if (!streamDone && gen === this.playbackGen) {
          this.streamFinishTimer = window.setTimeout(() => {
            this.streamFinishTimer = null;
            if (gen === this.playbackGen) finishStream();
          }, 1500);
        }
      }
    };

    // Playback promise — same contract as the blob path: resolves when the
    // audio finishes playing (or errors / is stopped).
    const playbackPromise = new Promise<{ blobUrl: string }>((resolve) => {
      this.stopResolver = () => {
        resolve({ blobUrl: resultBlobUrl });
      };

      audio.onplay = () => {
        if (gen === this.playbackGen) this.notify(true);
      };

      audio.onended = () => {
        if (gen !== this.playbackGen) return;
        this.notify(false);
        this.currentAudio = null;
        this.stopResolver = null;
        this.clearStreamState();
        resolve({ blobUrl: resultBlobUrl });
      };

      audio.onpause = () => {
        if (gen === this.playbackGen) this.notify(false);
      };

      audio.onerror = () => {
        if (gen !== this.playbackGen) return;
        console.warn('Streaming audio playback error');
        this.notify(false);
        this.currentAudio = null;
        this.stopResolver = null;
        this.clearStreamState();
        resolve({ blobUrl: resultBlobUrl });
      };
    });

    // Setup phase: wait for the SourceBuffer to open, start the background
    // pump FIRST so audio data keeps flowing, then confirm playback
    // actually starts. If any of that fails, return null so the caller
    // falls back to the buffered endpoint.
    // (Previously only one chunk was appended before the play/commit
    // decision, so a first chunk without a complete decodable frame
    // tripped the timeout on a healthy stream — and the fallback then
    // played the same reply a second time.)
    let onCanPlay: (() => void) | null = null;
    let onPlaying: (() => void) | null = null;
    let onPlayErr: (() => void) | null = null;
    try {
      await new Promise<void>((resolve, reject) => {
        const timeoutId = setTimeout(() => reject(new Error('MediaSource open timed out')), 5000);
        const onOpen = () => {
          clearTimeout(timeoutId);
          mediaSource.removeEventListener('sourceopen', onOpen);
          resolve();
        };
        mediaSource.addEventListener('sourceopen', onOpen);
      });

      sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');
      sourceBuffer.addEventListener('updateend', () => {
        appending = false;
        if (gen !== this.playbackGen) return;
        pumpQueue();
        // Trim already-played audio so long replies can't stall on
        // SourceBuffer quota (no trimming existed before).
        try {
          if (sourceBuffer && !sourceBuffer.updating && mediaSource.readyState === 'open') {
            const buffered = audio.buffered;
            if (buffered.length > 0) {
              const playedThrough = audio.currentTime;
              const bufferedStart = buffered.start(0);
              const bufferedEnd = buffered.end(buffered.length - 1);
              if (bufferedEnd - bufferedStart > 30 && playedThrough - bufferedStart > 10) {
                sourceBuffer.remove(bufferedStart, Math.max(bufferedStart, playedThrough - 5));
              }
            }
          }
        } catch {}
        if (readerDone && appendQueue.length === 0) finishStream();
      });

      // Feed the stream in the background from here on; the play/commit
      // decision below waits on real buffered audio, not on one chunk.
      void pumpStream();

      // Wait until the element has enough buffered audio to start.
      await new Promise<void>((resolve, reject) => {
        const timeoutId = setTimeout(() => reject(new Error('Streaming audio never became playable')), 8000);
        onCanPlay = () => {
          clearTimeout(timeoutId);
          if (onCanPlay) audio.removeEventListener('canplay', onCanPlay);
          resolve();
        };
        audio.addEventListener('canplay', onCanPlay);
        // Already playable (very short / cached clip served instantly).
        if (audio.readyState >= 2) {
          clearTimeout(timeoutId);
          if (onCanPlay) audio.removeEventListener('canplay', onCanPlay);
          resolve();
        }
      });
      if (gen !== this.playbackGen) throw new Error('Playback superseded');

      // Start playing, then confirm it really started before committing.
      const startedPromise = new Promise<boolean>((resolve) => {
        const timeoutId = setTimeout(() => {
          if (onPlaying) audio.removeEventListener('playing', onPlaying);
          if (onPlayErr) audio.removeEventListener('error', onPlayErr);
          resolve(false);
        }, 3000);
        onPlaying = () => {
          clearTimeout(timeoutId);
          if (onPlaying) audio.removeEventListener('playing', onPlaying);
          if (onPlayErr) audio.removeEventListener('error', onPlayErr);
          resolve(true);
        };
        onPlayErr = () => {
          clearTimeout(timeoutId);
          if (onPlaying) audio.removeEventListener('playing', onPlaying);
          if (onPlayErr) audio.removeEventListener('error', onPlayErr);
          resolve(false);
        };
        audio.addEventListener('playing', onPlaying);
        audio.addEventListener('error', onPlayErr);
      });

      await audio.play();
      if (gen !== this.playbackGen) throw new Error('Playback superseded');
      const started = await startedPromise;
      if (gen !== this.playbackGen) throw new Error('Playback superseded');
      if (!started) {
        throw new Error('Streaming playback did not start');
      }
    } catch (err) {
      console.warn('Streaming setup failed, falling back to buffered TTS:', err);
      // Hard cleanup: this element must NEVER keep playing in the
      // background while the buffered fallback starts. Pause it, strip
      // every handler, and drop the listeners added during setup.
      try { audio.pause(); } catch {}
      audio.onplay = null;
      audio.onended = null;
      audio.onpause = null;
      audio.onerror = null;
      if (onCanPlay) audio.removeEventListener('canplay', onCanPlay);
      if (onPlaying) audio.removeEventListener('playing', onPlaying);
      if (onPlayErr) audio.removeEventListener('error', onPlayErr);
      try { reader.cancel().catch(() => {}); } catch {}
      if (gen === this.playbackGen) {
        this.clearStreamState();
        if (this.currentAudio === audio) this.currentAudio = null;
        this.stopResolver = null;
      }
      return null;
    }

    // Committed: the background pump is already running.
    return playbackPromise;
  }

  private clearStreamState() {
    if (this.streamFinishTimer !== null) {
      clearTimeout(this.streamFinishTimer);
      this.streamFinishTimer = null;
    }
    if (this.streamController) {
      try { this.streamController.abort(); } catch {}
      this.streamController = null;
    }
    this.streamReader = null;
    if (this.streamMediaSource) {
      try {
        if (this.streamMediaSource.readyState === 'open') {
          this.streamMediaSource.endOfStream();
        }
      } catch {}
      this.streamMediaSource = null;
    }
    if (this.streamObjectUrl) {
      try { URL.revokeObjectURL(this.streamObjectUrl); } catch {}
      this.streamObjectUrl = null;
    }
  }

  public stop() {
    // Invalidate every in-flight playback first: stale handlers check
    // this token before touching shared state.
    this.playbackGen++;
    if (this.streamFinishTimer !== null) {
      clearTimeout(this.streamFinishTimer);
      this.streamFinishTimer = null;
    }
    if (this.currentAudio) {
      const audio = this.currentAudio;
      this.currentAudio = null;
      try { audio.pause(); } catch {}
      try { audio.currentTime = 0; } catch {}
      // A stopped element must never fire into the next playback.
      audio.onplay = null;
      audio.onended = null;
      audio.onpause = null;
      audio.onerror = null;
    }
    this.notify(false);
    if (this.stopResolver) {
      const resolve = this.stopResolver;
      this.stopResolver = null;
      resolve();
    }
    this.clearStreamState();
  }

  /**
   * Returns current audio amplitude between 0.0 and 1.0 for the pulsating orb
   */
  public getAudioLevel(): number {
    if (!this.isSpeaking) return 0;

    if (this.analyser && this.frequencyData) {
      this.analyser.getByteFrequencyData(this.frequencyData as any);
      let sum = 0;
      const count = Math.min(this.frequencyData.length, 32);
      for (let i = 0; i < count; i++) {
        sum += this.frequencyData[i];
      }
      const avg = sum / count;
      return Math.min(avg / 128, 1.0);
    }

    // Dynamic wave modulation fallback
    const time = Date.now() * 0.008;
    const wave = 0.5 + 0.3 * Math.sin(time) + 0.2 * Math.cos(time * 2.3);
    return Math.max(0.2, Math.min(wave, 1.0));
  }
}

export const audioManager = new GaspiracyAudioManager();
