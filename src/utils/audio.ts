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
   * Resolves when the audio finishes playing, allowing the voice-to-voice loop
   * to automatically re-engage the microphone.
   */
  public async playText(
    text: string,
    existingBlobUrl?: string,
    onReady?: (blobUrl: string) => void
  ): Promise<{ blobUrl: string }> {
    this.stop();
    this.initAudioContext();

    let blobUrl = existingBlobUrl;

    if (!blobUrl) {
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
      blobUrl = URL.createObjectURL(blob);
    }

    if (onReady && blobUrl) {
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
