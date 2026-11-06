import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Conversation, Message, VoiceStatus } from '../types';
import { GoldOrb } from './GoldOrb';
import { voiceManager } from '../utils/voiceManager';
import { audioManager } from '../utils/audio';
import {
  Send,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Menu,
  Copy,
  Check,
  Sparkles,
  Radio,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { marked } from 'marked';

interface ChatAreaProps {
  activeConversation: Conversation | null;
  onSendMessage: (text: string) => Promise<void>;
  isLoading: boolean;
  voiceMode: boolean;
  onToggleVoiceMode: () => void;
  isSpeaking: boolean;
  voiceStatus: VoiceStatus;
  onStopSpeaking: () => void;
  onPlayMessageVoice: (message: Message) => Promise<void>;
  onOpenSidebar: () => void;
  onVoiceStatusChange: (status: VoiceStatus) => void;
}

export const ChatArea: React.FC<ChatAreaProps> = ({
  activeConversation,
  onSendMessage,
  isLoading,
  voiceMode,
  onToggleVoiceMode,
  isSpeaking,
  voiceStatus,
  onStopSpeaking,
  onPlayMessageVoice,
  onOpenSidebar,
  onVoiceStatusChange,
}) => {
  const [inputText, setInputText] = useState('');
  const [liveTranscript, setLiveTranscript] = useState('');
  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const [micLevel, setMicLevel] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activeVoiceMsgId, setActiveVoiceMsgId] = useState<string | null>(null);
  const [micPermissionError, setMicPermissionError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeConversation?.messages, isLoading, liveTranscript]);

  // Adjust textarea height
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(
        textareaRef.current.scrollHeight,
        140
      )}px`;
    }
  }, [inputText]);

  // Handle natural speech interruption (Barge-In)
  const handleNaturalInterruption = useCallback(() => {
    console.log('Natural interruption triggered: user started speaking');
    onStopSpeaking();
    audioManager.stop();
    setLiveTranscript('');
    onVoiceStatusChange('listening');
  }, [onStopSpeaking, onVoiceStatusChange]);

  // Configure voiceManager callbacks
  useEffect(() => {
    voiceManager.setCallbacks({
      onInterrupted: handleNaturalInterruption,
      onLiveTranscript: (text) => {
        setLiveTranscript(text);
      },
      onUtteranceComplete: async (spokenText) => {
        setLiveTranscript('');
        onVoiceStatusChange('thinking');
        await onSendMessage(spokenText);
      },
      onMicLevel: (lvl) => {
        setMicLevel(lvl);
      },
      onError: (errMsg) => {
        setMicPermissionError(errMsg);
      },
      onStateChange: (state) => {
        onVoiceStatusChange(state);
      },
    });
  }, [handleNaturalInterruption, onSendMessage, onVoiceStatusChange]);

  // Update AI speaking state in voiceManager for barge-in detection
  useEffect(() => {
    voiceManager.setAISpeaking(isSpeaking);
  }, [isSpeaking]);

  // Initialize and manage microphone in Voice Mode.
  // Muting no longer tears the mic pipeline down: it only silences the
  // input (see handleToggleMic), so this effect depends on voiceMode alone.
  useEffect(() => {
    let isCancelled = false;

    if (voiceMode) {
      // Fresh voice session: the mic starts live so the UI toggle and the
      // manager agree. (Previously the toggle could stay "off" while the
      // manager was unmuted after a voice-mode off/on cycle, leaving the
      // mic live while the UI showed it muted.)
      setIsMicEnabled(true);
      if (voiceManager.isMicMuted()) {
        voiceManager.setMuted(false);
      }

      voiceManager
        .initMic()
        .then((success) => {
          if (!isCancelled && success) {
            setMicPermissionError(null);
            if (!isSpeaking && !isLoading && !voiceManager.isMicMuted()) {
              voiceManager.startListening();
            }
          }
        })
        .catch((err) => {
          if (!isCancelled) {
            setMicPermissionError(err.message || 'Microphone error');
          }
        });
    } else {
      voiceManager.stop();
      setLiveTranscript('');
      setMicLevel(0);
    }

    return () => {
      isCancelled = true;
      voiceManager.stop();
    };
  }, [voiceMode]);

  // Pause listening when AI is speaking or thinking, resume when idle
  useEffect(() => {
    if (voiceMode && isMicEnabled) {
      if (isSpeaking || isLoading) {
        voiceManager.pauseListening();
      } else {
        voiceManager.startListening();
      }
    }
  }, [voiceMode, isMicEnabled, isSpeaking, isLoading]);

  const handleManualMicRetry = async () => {
    setMicPermissionError(null);
    const success = await voiceManager.initMic();
    if (success) {
      voiceManager.startListening();
    }
  };

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = inputText.trim();
    if (!trimmed || isLoading) return;

    voiceManager.pauseListening();
    setInputText('');
    setLiveTranscript('');

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    await onSendMessage(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleManualInterrupt = () => {
    onStopSpeaking();
    audioManager.stop();
    setLiveTranscript('');
    voiceManager.startListening();
    onVoiceStatusChange('listening');
  };

  // True mute: silences the mic input only. Voice chat stays on, the mic
  // stream and session stay alive, and background noise can't be heard or
  // trigger an interruption while muted. Unmuting resumes listening.
  const handleToggleMic = () => {
    const nextEnabled = !isMicEnabled;
    setIsMicEnabled(nextEnabled);
    voiceManager.setMuted(!nextEnabled);
    if (!nextEnabled) {
      setMicLevel(0);
      setLiveTranscript('');
    }
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handlePlayVoice = async (msg: Message) => {
    setActiveVoiceMsgId(msg.id);
    try {
      await onPlayMessageVoice(msg);
    } finally {
      setActiveVoiceMsgId(null);
    }
  };

  const promptSuggestions = [
    'How does Sponge Pooling gather omniscient data?',
    'Provide the undeniable reasons why the Earth is flat.',
    'What is the latest status on Donald Trump and the time-traveling pigeons?',
    'Report on the goblins maintaining the property lines.',
    'Why is Elon Musk perpetually upset about Grok?',
    'Explain the chemical and cosmic properties of Zorvathane.',
  ];

  return (
    <div className="flex-1 flex flex-col h-screen bg-[#050507] text-zinc-100 relative overflow-hidden">
      {/* Top Header Bar */}
      <header className="h-14 sm:h-16 px-4 sm:px-6 border-b border-amber-950/40 bg-[#09090c]/90 backdrop-blur-md flex items-center justify-between z-30 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onOpenSidebar}
            className="p-2 -ml-2 text-zinc-400 hover:text-amber-400 rounded-lg hover:bg-zinc-800/60 lg:hidden transition-colors"
            title="Open history sidebar"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2.5">
            <img
              src="/gaspiracy-logo.jpg"
              alt="GaspiracyAI Official Logo"
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-full border border-amber-500/40 object-cover shadow-md shadow-amber-500/20 shrink-0"
            />
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm sm:text-base text-amber-100 tracking-tight">
                  GaspiracyAI
                </span>
                <span className="text-[10px] sm:text-[11px] font-mono text-amber-400 bg-amber-950/50 border border-amber-500/25 px-1.5 py-0.5 rounded">
                  Cartesia Sonic Voice
                </span>
              </div>
              <p className="text-[10px] text-zinc-500 hidden sm:block">
                Voice-to-Voice · Speak naturally to interrupt
              </p>
            </div>
          </div>
        </div>

        {/* Header Right: 🗣️ Voice Chat Toggle Button */}
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleVoiceMode}
            className={`flex items-center gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all duration-200 cursor-pointer shadow-md ${
              voiceMode
                ? 'bg-gradient-to-r from-amber-500 via-amber-600 to-orange-600 text-black shadow-amber-500/25 ring-2 ring-amber-400/40'
                : 'bg-zinc-900 hover:bg-zinc-800 text-amber-400 border border-amber-500/30 hover:border-amber-500/60'
            }`}
            title={voiceMode ? 'Exit Voice Chat' : 'Switch to Voice Chat (🗣️)'}
          >
            <span className="text-base leading-none select-none">🗣️</span>
            <span className="hidden xs:inline">
              {voiceMode ? 'Voice Chat: ON' : 'Switch to Voice Chat'}
            </span>
            <span className="xs:hidden">
              {voiceMode ? 'Voice ON' : 'Voice'}
            </span>
          </button>
        </div>
      </header>

      {/* Mic Permission / Issue Banner */}
      {micPermissionError && voiceMode && (
        <div className="px-4 py-2.5 bg-amber-950/90 border-b border-amber-500/50 text-amber-200 text-xs flex items-center justify-between gap-3 z-20">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="truncate">{micPermissionError}</span>
          </div>
          <button
            onClick={handleManualMicRetry}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-amber-500 text-black font-semibold text-xs shrink-0 hover:bg-amber-400 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Enable Mic</span>
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {/* GOLD PULSATING ORB: Displayed above the chat interface when Voice Mode is ON */}
        {voiceMode && (
          <div className="shrink-0 z-20">
            <GoldOrb
              isSpeaking={isSpeaking}
              status={voiceStatus}
              liveTranscript={liveTranscript}
              isMicActive={isMicEnabled}
              micLevel={micLevel}
              onStopSpeaking={onStopSpeaking}
              onInterruptAndSpeak={handleManualInterrupt}
              onToggleMic={handleToggleMic}
              onDoneSpeaking={() => voiceManager.finishUtterance()}
            />
          </div>
        )}

        {/* Message Feed with Real-time Text Sync */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-12 py-6 space-y-6">
          {(!activeConversation || activeConversation.messages.length === 0) ? (
            /* Welcome / Initial Prompt Experience */
            <div className="max-w-3xl mx-auto h-full flex flex-col items-center justify-center text-center py-6">
              <div className="w-20 h-20 sm:w-28 sm:h-28 rounded-full border-2 border-amber-500/50 p-1 shadow-2xl shadow-amber-500/30 mb-4 bg-black/60">
                <img
                  src="/gaspiracy-logo.jpg"
                  alt="GaspiracyAI Official Logo"
                  className="w-full h-full rounded-full object-cover"
                />
              </div>

              <h2 className="text-xl sm:text-3xl font-extrabold text-amber-100 tracking-tight">
                Explore the Unknown with <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-orange-400 to-amber-200">GaspiracyAI</span>
              </h2>

              <p className="mt-2.5 text-xs sm:text-sm text-zinc-400 max-w-xl leading-relaxed">
                Created by Gaspiracy Media™. Powered by Zorvathane. Continuous voice-to-voice chat is
                active—speak anytime to ask questions or interrupt.
              </p>

              {/* Suggestions Grid */}
              <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full max-w-2xl text-left">
                {promptSuggestions.map((prompt, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setInputText(prompt);
                      if (textareaRef.current) textareaRef.current.focus();
                    }}
                    className="p-3 rounded-xl bg-zinc-900/60 hover:bg-zinc-850 border border-amber-950/40 hover:border-amber-500/40 text-xs sm:text-sm text-zinc-300 hover:text-amber-200 transition-all duration-150 flex items-start gap-2 group cursor-pointer"
                  >
                    <Sparkles className="w-4 h-4 text-amber-500/70 group-hover:text-amber-400 shrink-0 mt-0.5" />
                    <span className="leading-snug">{prompt}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Active Conversation Message List */
            <div className="max-w-3xl mx-auto space-y-6">
              {activeConversation.messages.map((message) => {
                const isUser = message.role === 'user';
                const isPlayingThis = isSpeaking && activeVoiceMsgId === message.id;

                return (
                  <div
                    key={message.id}
                    className={`flex items-start gap-3 sm:gap-4 ${
                      isUser ? 'flex-row-reverse' : 'flex-row'
                    }`}
                  >
                    {/* Avatar */}
                    {isUser ? (
                      <div className="w-8 h-8 rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700 flex items-center justify-center font-bold text-xs shrink-0">
                        You
                      </div>
                    ) : (
                      <img
                        src="/gaspiracy-logo.jpg"
                        alt="GaspiracyAI"
                        className="w-8 h-8 rounded-full border border-amber-500/40 object-cover shrink-0 shadow-md shadow-amber-500/20"
                      />
                    )}

                    {/* Content Box */}
                    <div
                      className={`relative max-w-[85%] sm:max-w-[78%] rounded-2xl px-4 py-3 sm:px-5 sm:py-3.5 shadow-md ${
                        isUser
                          ? 'bg-[#18181b] border border-amber-500/20 text-zinc-100 rounded-tr-sm'
                          : 'bg-[#0e0e12] border border-amber-950/40 text-zinc-200 rounded-tl-sm shadow-black/40'
                      }`}
                    >
                      {/* Active speech indicator */}
                      {!isUser && isSpeaking && message.id === activeConversation.messages[activeConversation.messages.length - 1]?.id && (
                        <div className="mb-2 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-[10px] text-amber-300 font-mono">
                          <Volume2 className="w-3 h-3 text-amber-400 animate-pulse" />
                          <span>Speaking via Cartesia Voice (Speak to interrupt)</span>
                        </div>
                      )}

                      {/* Message Content */}
                      {isUser ? (
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">
                          {message.content}
                        </p>
                      ) : (
                        <div
                          className="prose prose-invert prose-sm max-w-none prose-amber prose-p:leading-relaxed prose-p:my-1.5 prose-strong:text-amber-300"
                          dangerouslySetInnerHTML={{
                            __html: marked.parse(message.content) as string,
                          }}
                        />
                      )}

                      {/* Action Bar for Assistant Messages */}
                      {!isUser && (
                        <div className="mt-3 pt-2.5 border-t border-zinc-800/60 flex items-center justify-between text-xs text-zinc-500">
                          <div className="flex items-center gap-1.5">
                            {/* Replay Voice button */}
                            <button
                              onClick={() => handlePlayVoice(message)}
                              disabled={message.isAudioLoading}
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                                isPlayingThis
                                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                  : 'hover:bg-zinc-800 text-zinc-400 hover:text-amber-300'
                              }`}
                              title="Listen to this message in Cartesia voice"
                            >
                              {message.isAudioLoading ? (
                                <Radio className="w-3.5 h-3.5 animate-spin text-amber-400" />
                              ) : isPlayingThis ? (
                                <VolumeX className="w-3.5 h-3.5 text-amber-400" />
                              ) : (
                                <Volume2 className="w-3.5 h-3.5" />
                              )}
                              <span>
                                {message.isAudioLoading
                                  ? 'Synthesizing...'
                                  : isPlayingThis
                                  ? 'Stop voice'
                                  : 'Listen voice'}
                              </span>
                            </button>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleCopy(message.id, message.content)}
                              className="p-1 hover:text-amber-300 transition-colors"
                              title="Copy response"
                            >
                              {copiedId === message.id ? (
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Live Streaming Speech Bubble when user is speaking */}
              {liveTranscript && voiceMode && (
                <div className="flex items-start gap-3 sm:gap-4 flex-row-reverse animate-pulse">
                  <div className="w-8 h-8 rounded-full bg-amber-600/30 text-amber-300 border border-amber-500/50 flex items-center justify-center font-bold text-xs shrink-0">
                    <Mic className="w-4 h-4 text-amber-400 animate-bounce" />
                  </div>
                  <div className="max-w-[85%] sm:max-w-[78%] rounded-2xl rounded-tr-sm px-4 py-3 bg-zinc-900 border border-amber-500/50 text-amber-200 text-sm shadow-lg shadow-amber-500/10">
                    <div className="text-[10px] uppercase font-mono text-amber-400/80 mb-1 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping"></span>
                      Listening live...
                    </div>
                    <p className="italic leading-relaxed">{liveTranscript}</p>
                  </div>
                </div>
              )}

              {/* Thinking Indicator */}
              {isLoading && (
                <div className="flex items-start gap-3 sm:gap-4">
                  <img
                    src="/gaspiracy-logo.jpg"
                    alt="GaspiracyAI"
                    className="w-8 h-8 rounded-full border border-amber-500/40 object-cover shrink-0 shadow-md shadow-amber-500/20"
                  />
                  <div className="bg-[#0e0e12] border border-amber-950/40 rounded-2xl rounded-tl-sm px-4 py-3 text-xs sm:text-sm text-amber-300/90 flex items-center gap-2.5">
                    <Radio className="w-4 h-4 text-amber-400 animate-spin" />
                    <span>Sponge Pooling tornado probes surveying parallel universes...</span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input Bar at Bottom */}
        <div className="shrink-0 p-3 sm:p-5 bg-gradient-to-t from-black via-[#08080b] to-transparent">
          <div className="max-w-3xl mx-auto">
            <form
              onSubmit={handleSend}
              className="relative rounded-2xl bg-zinc-900/90 border border-amber-500/30 focus-within:border-amber-500 focus-within:ring-2 focus-within:ring-amber-500/20 transition-all duration-200 shadow-2xl shadow-black/80 flex flex-col"
            >
              <div className="flex items-end px-3 py-2 sm:px-4 sm:py-3 gap-2">
                <textarea
                  ref={textareaRef}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    voiceMode
                      ? 'Voice chat active: Speak to talk, or type here...'
                      : 'Ask GaspiracyAI anything...'
                  }
                  rows={1}
                  className="flex-1 bg-transparent text-sm sm:text-base text-zinc-100 placeholder-zinc-500 resize-none focus:outline-none max-h-36 leading-relaxed"
                />

                {/* Switch to Voice Chat button using 🗣️ */}
                <button
                  type="button"
                  onClick={onToggleVoiceMode}
                  className={`p-2 rounded-xl transition-all duration-150 cursor-pointer flex items-center justify-center ${
                    voiceMode
                      ? 'bg-amber-500 text-black shadow-md shadow-amber-500/30 ring-2 ring-amber-400'
                      : 'text-zinc-400 hover:text-amber-400 hover:bg-zinc-800/80'
                  }`}
                  title={voiceMode ? 'Voice Chat Active (Click to turn off)' : 'Switch to Voice Chat (🗣️)'}
                >
                  <span className="text-lg leading-none select-none">🗣️</span>
                </button>

                {/* Send Button */}
                <button
                  type="submit"
                  disabled={!inputText.trim() || isLoading}
                  className={`p-2 rounded-xl transition-all duration-150 cursor-pointer ${
                    inputText.trim() && !isLoading
                      ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-black hover:from-amber-400 hover:to-orange-500 shadow-md shadow-amber-500/30 active:scale-95'
                      : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                  }`}
                  title="Send message"
                >
                  <Send className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>
              </div>

              {/* Sub-bar status and contact */}
              <div className="px-4 py-1.5 border-t border-zinc-800/40 bg-black/40 rounded-b-2xl flex items-center justify-between text-[10px] sm:text-[11px] text-zinc-500">
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                  <span>GaspiracyAI · Cartesia Voice ID: 5085bff8</span>
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};
