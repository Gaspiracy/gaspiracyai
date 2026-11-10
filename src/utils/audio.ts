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

    if (existingBlobUrl) {
      return this.playBlobUrl(existingBlobUrl, onReady);
    }

    // Streaming first: audio starts when the first chunk arrives instead
    // of waiting for the whole MP3. Falls back to the buffered endpoint
    // if streaming is unavailable or fails before playback starts.
    const streamed = await this.playStreamed(text, onReady).catch((err) => {
      console.warn('Streaming playback failed, falling back to buffered TTS:', err);
      return null;
    });
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
    const blobUrl = URL.createObjectURL(blob);
    return this.playBlobUrl(blobUrl, onReady);
  }

  /**
   * Plays an already-built blob URL (cached replay or buffered fallback).
   * Resolves when the audio finishes playing.
   */
  private playBlobUrl(
    blobUrl: string,
    onReady?: (blobUrl: string) => void
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
        this.notify(true);
      };

      audio.onended = () => {
        this.notify(false);
        this.currentAudio = null;
        this.stopResolver = null;
        resolve({ blobUrl: blobUrl! });
      };

      audio.onpause = () => {
        this.notify(false);
      };

      audio.onerror = (e) => {
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
    onReady?: (blobUrl: string) => void
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

    const finishStream = () => {
      if (streamDone) return;
      streamDone = true;
      try {
        if (sourceBuffer && !sourceBuffer.updating && mediaSource.readyState === 'open') {
          mediaSource.endOfStream();
        }
      } catch {}
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
    };

    const pumpQueue = () => {
      if (appending || !sourceBuffer || appendQueue.length === 0) return;
      if (sourceBuffer.updating) return;
      appending = true;
      const chunk = appendQueue.shift()!;
      try {
        sourceBuffer.appendBuffer(new Uint8Array(chunk));
      } catch (err) {
        appending = false;
        console.warn('SourceBuffer append failed:', err);
      }
    };

    // Background pump: keeps feeding chunks after playback has started.
    const pumpStream = async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value && value.length > 0) {
            chunks.push(value);
            appendQueue.push(value);
            pumpQueue();
          }
        }
        completedNormally = true;
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
      }
    };

    // Playback promise — same contract as the blob path: resolves when the
    // audio finishes playing (or errors / is stopped).
    const playbackPromise = new Promise<{ blobUrl: string }>((resolve) => {
      this.stopResolver = () => {
        resolve({ blobUrl: resultBlobUrl });
      };

      audio.onplay = () => {
        this.notify(true);
      };

      audio.onended = () => {
        this.notify(false);
        this.currentAudio = null;
        this.stopResolver = null;
        this.clearStreamState();
        resolve({ blobUrl: resultBlobUrl });
      };

      audio.onpause = () => {
        this.notify(false);
      };

      audio.onerror = () => {
        console.warn('Streaming audio playback error');
        this.notify(false);
        this.currentAudio = null;
        this.stopResolver = null;
        this.clearStreamState();
        resolve({ blobUrl: resultBlobUrl });
      };
    });

    // Setup phase: wait for the SourceBuffer to open, append the first
    // chunk, and confirm playback actually starts. If any of that fails,
    // return null so the caller falls back to the buffered endpoint.
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
        pumpQueue();
        if (readerDone && appendQueue.length === 0) finishStream();
      });

      // Read the first chunk and append it.
      const first = await reader.read();
      if (first.done || !first.value || first.value.length === 0) {
        throw new Error('TTS stream ended before any audio arrived');
      }
      chunks.push(first.value);
      appendQueue.push(first.value);
      pumpQueue();

      // Wait for the first append to land.
      const sb = sourceBuffer;
      if (!sb) throw new Error('SourceBuffer not initialized');
      await new Promise<void>((resolve, reject) => {
        const timeoutId = setTimeout(() => reject(new Error('First audio append timed out')), 5000);
        const check = () => {
          if (!appending && !sb.updating) {
            clearTimeout(timeoutId);
            sb.removeEventListener('updateend', check);
            resolve();
          }
        };
        sb.addEventListener('updateend', check);
        check();
      });

      // Start playing, then confirm it really started before committing.
      const startedPromise = new Promise<boolean>((resolve) => {
        const timeoutId = setTimeout(() => resolve(false), 2000);
        const onPlaying = () => {
          clearTimeout(timeoutId);
          audio.removeEventListener('playing', onPlaying);
          audio.removeEventListener('error', onErr);
          resolve(true);
        };
        const onErr = () => {
          clearTimeout(timeoutId);
          audio.removeEventListener('playing', onPlaying);
          audio.removeEventListener('error', onErr);
          resolve(false);
        };
        audio.addEventListener('playing', onPlaying);
        audio.addEventListener('error', onErr);
      });

      await audio.play();
      const started = await startedPromise;
      if (!started) {
        throw new Error('Streaming playback did not start');
      }
    } catch (err) {
      console.warn('Streaming setup failed, falling back to buffered TTS:', err);
      try { reader.cancel().catch(() => {}); } catch {}
      this.clearStreamState();
      if (this.currentAudio === audio) this.currentAudio = null;
      this.stopResolver = null;
      return null;
    }

    // Committed: keep pumping the rest of the stream in the background.
    void pumpStream();
    return playbackPromise;
  }

  private clearStreamState() {
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
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }
    this.notify(false);
    if (this.stopResolver) {
      this.stopResolver();
      this.stopResolver = null;
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
