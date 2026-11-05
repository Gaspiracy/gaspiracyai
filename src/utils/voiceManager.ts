/**
 * Comprehensive Voice-to-Voice Manager
 * - Continuous Web Audio stream with echo cancellation
 * - Real-time Voice Activity Detection (VAD) for:
 *    1) Natural voice interruption (Barge-In) while AI is speaking
 *    2) Automatic silence detection after user speaks (triggers reply even if Web Speech API fails)
 * - Dual transcription: Web Speech API for instant interim text + MediaRecorder fallback via /api/transcribe
 * - Microphone level feedback for live UI visualizer
 */

export interface VoiceManagerCallbacks {
  onInterrupted: () => void;
  onLiveTranscript: (text: string) => void;
  onUtteranceComplete: (text: string) => void;
  onMicLevel: (level: number) => void;
  onError: (err: string) => void;
  onStateChange: (state: 'idle' | 'listening' | 'transcribing' | 'speaking') => void;
}

class GaspiracyVoiceManager {
  private mediaStream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private micData: Uint8Array | null = null;
  private animFrameId: number | null = null;

  private recognition: any = null;
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];

  private isEnabled: boolean = false;
  private isSpeakingAI: boolean = false;

  // VAD state
  private hasSpokenInThisTurn: boolean = false;
  private speechFramesCount: number = 0;
  private silenceFramesCount: number = 0;
  private isProcessingUtterance: boolean = false;

  private currentTranscript: string = '';
  private callbacks: VoiceManagerCallbacks | null = null;

  public setCallbacks(callbacks: VoiceManagerCallbacks) {
    this.callbacks = callbacks;
  }

  public setAISpeaking(speaking: boolean) {
    this.isSpeakingAI = speaking;
    if (speaking) {
      this.hasSpokenInThisTurn = false;
      this.speechFramesCount = 0;
      this.silenceFramesCount = 0;
    }
  }

  /**
   * Get instantaneous mic volume level (0.0 to 1.0) with vocal sensitivity curve
   */
  public getMicLevel(): number {
    if (!this.isEnabled || !this.analyser || !this.micData) return 0;
    try {
      this.analyser.getByteFrequencyData(this.micData as any);
      let sum = 0;
      const count = Math.min(this.micData.length, 32);
      for (let i = 0; i < count; i++) {
        sum += this.micData[i];
      }
      const raw = (sum / count) / 128;
      // Vocal boost curve so normal speaking volume creates vibrant pulsations
      return Math.min(Math.pow(raw, 0.7) * 1.5, 1.0);
    } catch {
      return 0;
    }
  }

  /**
   * Request microphone permission and initialize persistent audio analyzer
   */
  public async initMic(): Promise<boolean> {
    try {
      if (!this.mediaStream) {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      }

      if (!this.audioCtx) {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        this.audioCtx = new AudioCtx();
        const source = this.audioCtx.createMediaStreamSource(this.mediaStream);
        this.analyser = this.audioCtx.createAnalyser();
        this.analyser.fftSize = 256;
        this.analyser.smoothingTimeConstant = 0.3;
        this.micData = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
        source.connect(this.analyser);
      }

      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }

      this.startVADLoop();
      return true;
    } catch (err: any) {
      console.warn('Microphone initialization failed:', err);
      if (this.callbacks) {
        this.callbacks.onError(
          'Microphone permission blocked. Please allow microphone access to talk to GaspiracyAI.'
        );
      }
      return false;
    }
  }

  /**
   * Continuous VAD Loop:
   * Runs at ~60fps checking microphone audio levels.
   */
  private startVADLoop() {
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);

    const checkLevel = () => {
      if (!this.isEnabled) {
        this.animFrameId = requestAnimationFrame(checkLevel);
        return;
      }

      let currentLevel = 0;
      if (this.analyser && this.micData) {
        this.analyser.getByteFrequencyData(this.micData as any);
        let sum = 0;
        const count = Math.min(this.micData.length, 32);
        for (let i = 0; i < count; i++) {
          sum += this.micData[i];
        }
        currentLevel = Math.min((sum / count) / 128, 1.0);
      }

      if (this.callbacks) {
        this.callbacks.onMicLevel(currentLevel);
      }

      // Voice Activity Threshold (distinguish voice from ambient noise)
      const SPEECH_THRESHOLD = 0.07;

      if (this.isSpeakingAI) {
        // AI is talking: check if user starts speaking to interrupt (Barge-In)
        if (currentLevel > SPEECH_THRESHOLD) {
          this.speechFramesCount++;
          if (this.speechFramesCount >= 4) {
            console.log('Interruption detected: user spoke over AI');
            this.speechFramesCount = 0;
            if (this.callbacks) {
              this.callbacks.onInterrupted();
            }
          }
        } else {
          this.speechFramesCount = Math.max(0, this.speechFramesCount - 1);
        }
      } else if (!this.isProcessingUtterance) {
        // AI is NOT talking: user turn
        if (currentLevel > SPEECH_THRESHOLD) {
          this.speechFramesCount++;
          this.silenceFramesCount = 0;

          // If user speaks for >= 3 frames, flag that speech occurred in this turn
          if (this.speechFramesCount >= 3) {
            this.hasSpokenInThisTurn = true;
          }
        } else {
          this.speechFramesCount = 0;

          // If user previously spoke and now there is silence
          if (this.hasSpokenInThisTurn) {
            this.silenceFramesCount++;

            // ~45 frames at 60fps = ~750ms of silence after speaking
            if (this.silenceFramesCount >= 45) {
              console.log('VAD: silence detected after user speech. Triggering finishUtterance.');
              this.silenceFramesCount = 0;
              this.hasSpokenInThisTurn = false;
              this.finishUtterance();
            }
          }
        }
      }

      this.animFrameId = requestAnimationFrame(checkLevel);
    };

    this.animFrameId = requestAnimationFrame(checkLevel);
  }

  /**
   * Start listening for user speech
   */
  public startListening() {
    this.isEnabled = true;
    this.isProcessingUtterance = false;
    this.hasSpokenInThisTurn = false;
    this.speechFramesCount = 0;
    this.silenceFramesCount = 0;
    this.currentTranscript = '';
    this.recordedChunks = [];

    // 1. Start MediaRecorder
    if (this.mediaStream) {
      try {
        const mimeType = MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : '';

        const options = mimeType ? { mimeType } : undefined;
        this.mediaRecorder = new MediaRecorder(this.mediaStream, options);
        this.recordedChunks = [];

        this.mediaRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            this.recordedChunks.push(e.data);
          }
        };

        this.mediaRecorder.start(200);
      } catch (e) {
        console.warn('MediaRecorder start error:', e);
      }
    }

    // 2. Start Web Speech API if supported
    const SpeechRecognitionClass =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (SpeechRecognitionClass) {
      try {
        if (!this.recognition) {
          const rec = new SpeechRecognitionClass();
          rec.continuous = true;
          rec.interimResults = true;
          rec.lang = 'en-US';

          rec.onresult = (event: any) => {
            let interim = '';
            let final = '';

            for (let i = event.resultIndex; i < event.results.length; ++i) {
              const text = event.results[i][0].transcript;
              if (event.results[i].isFinal) {
                final += text;
              } else {
                interim += text;
              }
            }

            const spoken = (final || interim).trim();
            if (spoken) {
              this.currentTranscript = spoken;
              this.hasSpokenInThisTurn = true;
              if (this.callbacks) {
                this.callbacks.onLiveTranscript(spoken);
              }
            }
          };

          rec.onerror = (e: any) => {
            console.warn('SpeechRecognition error:', e.error);
          };

          rec.onend = () => {
            if (this.isEnabled && !this.isSpeakingAI && !this.isProcessingUtterance) {
              try {
                rec.start();
              } catch (e) {}
            }
          };

          this.recognition = rec;
        }

        try {
          this.recognition.start();
        } catch (e) {}
      } catch (e) {
        console.warn('SpeechRecognition init note:', e);
      }
    }

    if (this.callbacks) {
      this.callbacks.onStateChange('listening');
    }
  }

  /**
   * Called when silence is detected after user speaks
   */
  public finishUtterance() {
    if (this.isProcessingUtterance) return;
    this.isProcessingUtterance = true;

    const transcript = this.currentTranscript.trim();

    // Stop Web Speech API
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (e) {}
    }

    // Flush MediaRecorder
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.onstop = () => {
        this.handleCapturedAudio(transcript);
      };
      try {
        this.mediaRecorder.stop();
      } catch (e) {
        this.handleCapturedAudio(transcript);
      }
    } else {
      this.handleCapturedAudio(transcript);
    }
  }

  private async handleCapturedAudio(transcript: string) {
    if (transcript) {
      // Primary: Web Speech API transcript captured
      this.currentTranscript = '';
      if (this.callbacks) {
        this.callbacks.onUtteranceComplete(transcript);
      }
      return;
    }

    // Secondary: Transcribe recorded audio chunks via /api/transcribe
    if (this.recordedChunks.length > 0) {
      if (this.callbacks) {
        this.callbacks.onStateChange('transcribing');
      }

      try {
        const audioBlob = new Blob(this.recordedChunks, {
          type: this.mediaRecorder?.mimeType || 'audio/webm',
        });

        // If audio blob is too tiny (< 500 bytes), it was likely just a click
        if (audioBlob.size < 500) {
          this.isProcessingUtterance = false;
          this.startListening();
          return;
        }

        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          const base64Data = (reader.result as string)?.split(',')[1];
          if (!base64Data) {
            this.isProcessingUtterance = false;
            this.startListening();
            return;
          }

          try {
            const res = await fetch('/api/transcribe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                audioBase64: base64Data,
                mimeType: audioBlob.type || 'audio/webm',
              }),
            });

            if (res.ok) {
              const data = await res.json();
              if (data.transcript && data.transcript.trim()) {
                console.log('Server transcription success:', data.transcript);
                if (this.callbacks) {
                  this.callbacks.onUtteranceComplete(data.transcript.trim());
                }
                return;
              }
            }
          } catch (err) {
            console.warn('Server transcribe error:', err);
          }

          // If no speech recognized from audio, resume listening
          this.isProcessingUtterance = false;
          this.startListening();
        };
      } catch (err) {
        console.warn('Audio processing error:', err);
        this.isProcessingUtterance = false;
        this.startListening();
      }
    } else {
      // Nothing captured, resume listening
      this.isProcessingUtterance = false;
      this.startListening();
    }
  }

  /**
   * Pause listening (when GaspiracyAI is speaking or thinking)
   */
  public pauseListening() {
    this.isProcessingUtterance = false;
    this.hasSpokenInThisTurn = false;
    this.speechFramesCount = 0;
    this.silenceFramesCount = 0;

    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (e) {}
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch (e) {}
    }
  }

  /**
   * Stop voice mode completely
   */
  public stop() {
    this.isEnabled = false;
    this.pauseListening();
    this.currentTranscript = '';
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }
}

export const voiceManager = new GaspiracyVoiceManager();
