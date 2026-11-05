import React, { useEffect, useRef } from 'react';
import { audioManager } from '../utils/audio';
import { voiceManager } from '../utils/voiceManager';
import { Volume2, VolumeX, Radio, Sparkles, Mic, MicOff } from 'lucide-react';
import { VoiceStatus } from '../types';

interface GoldOrbProps {
  isSpeaking: boolean;
  status: VoiceStatus;
  liveTranscript?: string;
  isMicActive?: boolean;
  micLevel?: number;
  onStopSpeaking?: () => void;
  onInterruptAndSpeak?: () => void;
  onToggleMic?: () => void;
  onDoneSpeaking?: () => void;
}

export const GoldOrb: React.FC<GoldOrbProps> = ({
  isSpeaking,
  status,
  liveTranscript,
  isMicActive = true,
  micLevel = 0,
  onStopSpeaking,
  onInterruptAndSpeak,
  onToggleMic,
  onDoneSpeaking,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let phase = 0;
    let smoothLevel = 0;

    // Load the exact reference orb image
    const orbImg = new Image();
    orbImg.src = '/reference-orb.png';
    let imgLoaded = false;
    orbImg.onload = () => {
      imgLoaded = true;
    };

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      const centerX = width / 2;
      // Position the orb lower down in the canvas
      const centerY = height / 2 + 10;

      ctx.clearRect(0, 0, width, height);

      // Read audio amplitude from AI speech OR user microphone in real time
      const aiLevel = isSpeaking ? audioManager.getAudioLevel() : 0;
      const userLevel = (!isSpeaking && isMicActive) ? voiceManager.getMicLevel() : 0;
      const rawLevel = Math.max(aiLevel, userLevel);

      smoothLevel += (rawLevel - smoothLevel) * 0.28;
      phase += 0.02 + smoothLevel * 0.04;

      // Base radius calculation: clean pulsing of the orb itself without any emitting waves
      const baseRadius = 88;
      const breathing = Math.sin(phase) * 1.5;
      const speechExpansion = smoothLevel * 18;
      const currentRadius = baseRadius + breathing + speechExpansion;
      const drawSize = currentRadius * 2;

      // Draw strictly the clean celestial orb (NO radiating rings or waves)
      if (imgLoaded) {
        ctx.save();
        // Subtle soft perimeter edge glow, no outer wave rings
        ctx.shadowColor = `rgba(234, 88, 12, ${0.35 + smoothLevel * 0.3})`;
        ctx.shadowBlur = 10 + smoothLevel * 20;

        ctx.translate(centerX, centerY);

        ctx.drawImage(
          orbImg,
          -drawSize / 2,
          -drawSize / 2,
          drawSize,
          drawSize
        );

        // Soft internal cloud luminosity surge during speech (no external waves)
        if (smoothLevel > 0.02) {
          ctx.globalCompositeOperation = 'screen';
          const flareGrad = ctx.createRadialGradient(
            0,
            -drawSize * 0.15,
            0,
            0,
            0,
            drawSize * 0.48
          );
          flareGrad.addColorStop(0, `rgba(254, 240, 138, ${smoothLevel * 0.4})`);
          flareGrad.addColorStop(0.5, `rgba(245, 158, 11, ${smoothLevel * 0.2})`);
          flareGrad.addColorStop(1, 'rgba(234, 88, 12, 0)');

          ctx.beginPath();
          ctx.arc(0, 0, drawSize / 2, 0, Math.PI * 2);
          ctx.fillStyle = flareGrad;
          ctx.fill();
        }

        ctx.restore();
      } else {
        // Fallback clean circle with matching gradient
        const fallbackGrad = ctx.createLinearGradient(
          centerX,
          centerY - currentRadius,
          centerX,
          centerY + currentRadius
        );
        fallbackGrad.addColorStop(0, '#fef08a');
        fallbackGrad.addColorStop(0.35, '#f59e0b');
        fallbackGrad.addColorStop(0.65, '#ea580c');
        fallbackGrad.addColorStop(1, '#9a3412');

        ctx.beginPath();
        ctx.arc(centerX, centerY, currentRadius, 0, Math.PI * 2);
        ctx.fillStyle = fallbackGrad;
        ctx.fill();
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [isSpeaking, status, isMicActive]);

  return (
    <div className="relative w-full flex flex-col items-center justify-center pt-8 sm:pt-14 pb-5 px-4 bg-gradient-to-b from-transparent via-black/40 to-black/70 border-b border-amber-500/20 shadow-xl">
      {/* Visual Canvas of the Exact Reference Orb (Lower down, clean, zero waves) */}
      <div className="relative flex items-center justify-center">
        <canvas
          ref={canvasRef}
          width={360}
          height={240}
          className="w-[280px] h-[190px] sm:w-[350px] sm:h-[235px] pointer-events-none"
        />

        {/* Quiet, stationary ambient background backlight (no pulsating rings) */}
        <div
          className={`absolute -z-10 rounded-full blur-2xl transition-all duration-500 pointer-events-none ${
            isSpeaking || micLevel > 0.1
              ? 'w-44 h-44 bg-orange-600/20'
              : 'w-36 h-36 bg-amber-600/10'
          }`}
        />
      </div>

      {/* Dynamic Voice Status pill */}
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2 max-w-xl">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-zinc-900/90 border border-amber-500/30 text-xs shadow-lg shadow-black/50">
          {isSpeaking ? (
            <>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
              </span>
              <Volume2 className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
              <span className="text-amber-200 font-medium">GaspiracyAI is speaking</span>
              <span className="text-[10px] text-amber-400/80 font-mono bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-500/30">
                Speak to interrupt
              </span>
            </>
          ) : status === 'thinking' ? (
            <>
              <Radio className="w-3.5 h-3.5 text-orange-400 animate-spin" />
              <span className="text-orange-200">Consulting the Sponge Pool...</span>
            </>
          ) : status === 'listening' ? (
            <>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <Mic className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
              <span className="text-emerald-300 font-medium">Listening to your voice... (Speak now)</span>

              {/* Real-time mic level audio bar */}
              <div className="flex items-center gap-0.5 h-3 ml-1">
                {[0.1, 0.25, 0.4, 0.6, 0.8].map((thresh, idx) => (
                  <span
                    key={idx}
                    className={`w-0.5 rounded-full transition-all duration-75 ${
                      micLevel >= thresh ? 'h-3 bg-emerald-400' : 'h-1 bg-zinc-700'
                    }`}
                  />
                ))}
              </div>
            </>
          ) : status === 'transcribing' ? (
            <>
              <Radio className="w-3.5 h-3.5 text-amber-400 animate-spin" />
              <span className="text-amber-300">Processing voice transmission...</span>
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span className="text-zinc-400">Voice-to-Voice Ready</span>
            </>
          )}
        </div>

        {/* Action button: Manual Interrupt & Speak */}
        {isSpeaking && onInterruptAndSpeak && (
          <button
            onClick={onInterruptAndSpeak}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-black bg-gradient-to-r from-amber-400 to-orange-400 hover:from-amber-300 hover:to-orange-300 rounded-full transition-all cursor-pointer shadow-md shadow-amber-500/20 active:scale-95"
            title="Interrupt GaspiracyAI and start speaking"
          >
            <Mic className="w-3.5 h-3.5" />
            <span>Interrupt</span>
          </button>
        )}

        {/* Action button: Stop audio */}
        {isSpeaking && onStopSpeaking && (
          <button
            onClick={onStopSpeaking}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-amber-400 bg-zinc-900/80 hover:bg-zinc-800 border border-amber-600/40 rounded-full transition-colors cursor-pointer"
            title="Mute current speech"
          >
            <VolumeX className="w-3 h-3" />
            <span>Mute</span>
          </button>
        )}

        {/* Mute/Unmute Mic Toggle */}
        {!isSpeaking && onToggleMic && (
          <button
            onClick={onToggleMic}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-full transition-colors cursor-pointer ${
              isMicActive
                ? 'bg-zinc-900/80 text-zinc-300 border border-zinc-700 hover:border-amber-500/40'
                : 'bg-red-950/60 text-red-300 border border-red-600/50'
            }`}
            title={isMicActive ? 'Mute microphone' : 'Unmute microphone'}
          >
            {isMicActive ? <Mic className="w-3 h-3 text-emerald-400" /> : <MicOff className="w-3 h-3 text-red-400" />}
            <span>{isMicActive ? 'Mic Active' : 'Mic Muted'}</span>
          </button>
        )}
      </div>

      {/* Live Interim Transcript when user is speaking */}
      {liveTranscript && status === 'listening' && (
        <div className="mt-3 px-4 py-2 max-w-lg rounded-xl bg-amber-950/60 border border-amber-500/50 flex items-center justify-between gap-3 shadow-lg animate-pulse">
          <p className="text-xs text-amber-200 italic font-medium truncate flex-1">
            &ldquo;{liveTranscript}&rdquo;
          </p>
          {onDoneSpeaking && (
            <button
              onClick={onDoneSpeaking}
              className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-semibold text-[11px] shrink-0 transition-colors shadow-sm cursor-pointer"
            >
              Send Now
            </button>
          )}
        </div>
      )}
    </div>
  );
};
