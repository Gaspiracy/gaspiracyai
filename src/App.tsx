import React, { useState, useEffect, useCallback } from 'react';
import { Conversation, Message, VoiceStatus } from './types';
import { Sidebar } from './components/Sidebar';
import { ChatArea } from './components/ChatArea';
import { audioManager } from './utils/audio';

const STORAGE_KEY_CONVERSATIONS = 'gaspiracy_conversations_v2';
const STORAGE_KEY_ACTIVE_ID = 'gaspiracy_active_id_v2';
const STORAGE_KEY_VOICE_MODE = 'gaspiracy_voice_mode_v2';

// Streams a chat reply from /api/chat-stream (SSE). Calls onDelta with
// each text chunk and the accumulated full text; resolves with the full
// reply. Throws if the stream can't start or fails before any token, so
// the caller can fall back to /api/chat. A mid-stream failure resolves
// with whatever arrived so far.
async function streamChat(
  messages: { role: string; content: string }[],
  onDelta: (delta: string, full: string) => void
): Promise<{ reply: string; streamedAny: boolean }> {
  const response = await fetch('/api/chat-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Chat stream failed: HTTP ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  let streamedAny = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of rawEvent.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload) continue;
          let event: any;
          try {
            event = JSON.parse(payload);
          } catch {
            continue;
          }
          if (typeof event.delta === 'string' && event.delta) {
            full += event.delta;
            streamedAny = true;
            onDelta(event.delta, full);
          } else if (event.done) {
            if (typeof event.reply === 'string') full = event.reply;
            return { reply: full, streamedAny: true };
          } else if (event.error) {
            if (streamedAny) return { reply: full, streamedAny: true };
            throw new Error(event.error);
          }
        }
      }
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  // Stream ended without a done event: keep what arrived, if anything.
  if (streamedAny) return { reply: full, streamedAny: true };
  throw new Error('Chat stream ended without a reply');
}

export default function App() {
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_CONVERSATIONS);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      console.warn('Failed to load conversations from storage:', e);
    }
    return [];
  });

  const [activeId, setActiveId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_ACTIVE_ID);
    } catch {
      return null;
    }
  });

  // Default Voice Mode to OFF: voice chat must never start on its own.
  // The stored preference is still honoured for the toggle itself, but
  // the microphone only activates after an explicit press in this
  // session (see voiceActivated below).
  const [voiceMode, setVoiceMode] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_VOICE_MODE);
      return stored !== null ? JSON.parse(stored) : false;
    } catch {
      return false;
    }
  });

  // Session-only gate: true only after the user has pressed the
  // voice-chat button in THIS session. Never persisted — a fresh page
  // load always starts with the mic off, even if voice mode was on
  // last visit.
  const [voiceActivated, setVoiceActivated] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('idle');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Sync state to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_CONVERSATIONS, JSON.stringify(conversations));
    } catch (e) {
      console.warn('Failed to save conversations:', e);
    }
  }, [conversations]);

  useEffect(() => {
    try {
      if (activeId) {
        localStorage.setItem(STORAGE_KEY_ACTIVE_ID, activeId);
      } else {
        localStorage.removeItem(STORAGE_KEY_ACTIVE_ID);
      }
    } catch (e) {
      console.warn('Failed to save active id:', e);
    }
  }, [activeId]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_VOICE_MODE, JSON.stringify(voiceMode));
    } catch (e) {
      console.warn('Failed to save voice mode preference:', e);
    }
  }, [voiceMode]);

  // Subscribe to audioManager events
  useEffect(() => {
    const unsubscribe = audioManager.subscribe((speaking) => {
      setIsSpeaking(speaking);
      if (speaking) {
        setVoiceStatus('speaking');
      } else {
        setVoiceStatus(voiceMode && voiceActivated ? 'listening' : 'idle');
      }
    });

    return () => {
      unsubscribe();
      audioManager.stop();
    };
  }, [voiceMode, voiceActivated]);

  // Ensure active conversation exists or select first
  useEffect(() => {
    if (conversations.length > 0) {
      if (!activeId || !conversations.some((c) => c.id === activeId)) {
        setActiveId(conversations[0].id);
      }
    } else {
      setActiveId(null);
    }
  }, [conversations, activeId]);

  const activeConversation =
    conversations.find((c) => c.id === activeId) || null;

  const handleNewConversation = useCallback(() => {
    audioManager.stop();
    const newConv: Conversation = {
      id: `conv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      title: 'New Conversation',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    };

    setConversations((prev) => [newConv, ...prev]);
    setActiveId(newConv.id);
  }, []);

  const handleDeleteConversation = useCallback(
    (id: string) => {
      audioManager.stop();
      setConversations((prev) => {
        const remaining = prev.filter((c) => c.id !== id);
        if (activeId === id) {
          setActiveId(remaining.length > 0 ? remaining[0].id : null);
        }
        return remaining;
      });
    },
    [activeId]
  );

  const handleRenameConversation = useCallback((id: string, newTitle: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title: newTitle } : c))
    );
  }, []);

  const handleToggleVoiceMode = () => {
    // Restored voice mode (ON from a previous visit) starts with the mic
    // off: the first press in this session activates it instead of
    // turning voice mode off, so one tap always gets the user talking.
    if (voiceMode && !voiceActivated) {
      setVoiceActivated(true);
      audioManager.unlock();
      setVoiceStatus('listening');
      return;
    }
    const nextMode = !voiceMode;
    setVoiceMode(nextMode);
    setVoiceActivated(nextMode);
    audioManager.unlock();
    if (!nextMode) {
      audioManager.stop();
      setVoiceStatus('idle');
    } else {
      setVoiceStatus('listening');
    }
  };

  const handleStopSpeaking = () => {
    audioManager.stop();
    setIsSpeaking(false);
    setVoiceStatus(voiceMode && voiceActivated ? 'listening' : 'idle');
  };

  const handlePlayMessageVoice = async (message: Message) => {
    // Listen always plays the selected message: any current audio is
    // stopped first (playText does that itself). The Stop behavior lives
    // in ChatArea, which knows which message is actually playing — a
    // Listen tap must never silently do nothing while other audio plays.
    // Optimistic speaking flag: keep the mic off from the moment
    // playback starts, not from the moment audio is first heard.
    setIsSpeaking(true);
    try {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeId
            ? {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === message.id ? { ...m, isAudioLoading: true } : m
                ),
              }
            : c
        )
      );

      await audioManager.playText(
        message.content,
        message.audioBlobUrl,
        (blobUrl) => {
          setConversations((prev) =>
            prev.map((c) =>
              c.id === activeId
                ? {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === message.id
                        ? { ...m, isAudioLoading: false, audioBlobUrl: blobUrl }
                        : m
                    ),
                  }
                : c
            )
          );
        }
      );
    } catch (err) {
      console.error('Error playing message voice:', err);
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeId
            ? {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === message.id ? { ...m, isAudioLoading: false } : m
                ),
              }
            : c
        )
      );
    } finally {
      // Clear the optimistic flag if audio never actually started (on a
      // normal finish the manager's own notify(false) already cleared it).
      if (!audioManager.getSpeaking()) setIsSpeaking(false);
    }
  };

  const handleSendMessage = async (text: string) => {
    let currentConvId = activeId;
    let targetConv = conversations.find((c) => c.id === currentConvId);

    // If no active conversation, create one
    if (!targetConv) {
      const newConv: Conversation = {
        id: `conv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        title: text.slice(0, 32) + (text.length > 32 ? '...' : ''),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
      };
      setConversations((prev) => [newConv, ...prev]);
      setActiveId(newConv.id);
      currentConvId = newConv.id;
      targetConv = newConv;
    }

    const userMessage: Message = {
      id: `msg_u_${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };

    const updatedMessages = [...targetConv.messages, userMessage];

    const isFirstMessage = targetConv.messages.length === 0;
    const newTitle = isFirstMessage
      ? text.slice(0, 32) + (text.length > 32 ? '...' : '')
      : targetConv.title;

    setConversations((prev) =>
      prev.map((c) =>
        c.id === currentConvId
          ? {
              ...c,
              title: newTitle,
              updatedAt: Date.now(),
              messages: updatedMessages,
            }
          : c
      )
    );

    setIsLoading(true);
    setVoiceStatus('thinking');

    // The assistant message is created up front so streamed tokens can
    // render into it as they arrive; the same id is reused by the
    // non-streaming fallback and the TTS cache callback.
    const assistantMessage: Message = {
      id: `msg_a_${Date.now()}`,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };

    const upsertAssistantMessage = (content: string) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === currentConvId
            ? {
                ...c,
                updatedAt: Date.now(),
                messages: c.messages.some((m) => m.id === assistantMessage.id)
                  ? c.messages.map((m) =>
                      m.id === assistantMessage.id ? { ...m, content } : m
                    )
                  : [...c.messages, { ...assistantMessage, content }],
              }
            : c
        )
      );
    };

    try {
      let assistantReply: string | null = null;

      // Stream first: the first words arrive in ~1-2 s instead of after
      // the full reply. If the stream can't start, fall back to the
      // non-streaming endpoint. A mid-stream failure keeps the partial
      // text already shown.
      try {
        const streamed = await streamChat(
          updatedMessages.map((m) => ({ role: m.role, content: m.content })),
          (_delta, full) => upsertAssistantMessage(full)
        );
        assistantReply = streamed.reply;
      } catch (streamErr) {
        console.warn('Chat stream failed, falling back to /api/chat:', streamErr);
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: updatedMessages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `HTTP ${response.status}`);
        }

        const data = await response.json();
        const fallbackReply: string = data.reply || 'The Sponge Pool returned an anomalous silence.';
        assistantReply = fallbackReply;
        upsertAssistantMessage(fallbackReply);
      }

      const finalReply = assistantReply || 'The Sponge Pool returned an anomalous silence.';
      if (!assistantReply) {
        upsertAssistantMessage(finalReply);
      }

      setIsLoading(false);

      // In Voice Mode, start speaking immediately with Cartesia TTS and await completion
      if (voiceMode) {
        setVoiceStatus('speaking');
        // Optimistic: keep the mic off from the moment TTS starts, not
        // from the moment audio is first heard — otherwise the mic goes
        // live in the gap between isLoading=false and playback starting
        // and can hear the AI's own voice.
        setIsSpeaking(true);
        try {
          await audioManager.playText(
            finalReply,
            undefined,
            (blobUrl) => {
              setConversations((prev) =>
                prev.map((c) =>
                  c.id === currentConvId
                    ? {
                        ...c,
                        messages: c.messages.map((m) =>
                          m.id === assistantMessage.id
                            ? { ...m, audioBlobUrl: blobUrl }
                            : m
                        ),
                      }
                    : c
                )
              );
            }
          );
          // When speech finishes, automatically resume listening
          setVoiceStatus(voiceActivated ? 'listening' : 'idle');
        } catch (ttsErr) {
          console.warn('Voice auto-play error:', ttsErr);
          setVoiceStatus(voiceActivated ? 'listening' : 'idle');
        } finally {
          // Clear the optimistic flag if audio never actually started (on
          // a normal finish the manager's own notify(false) already did).
          if (!audioManager.getSpeaking()) setIsSpeaking(false);
        }
      } else {
        setVoiceStatus('idle');
      }
    } catch (err: any) {
      console.error('Chat error:', err);
      setIsLoading(false);
      setVoiceStatus(voiceMode && voiceActivated ? 'listening' : 'idle');

      const errorMessage: Message = {
        id: `msg_err_${Date.now()}`,
        role: 'assistant',
        content: `**Pool Interruption:** ${err.message || 'The tornado probes encountered an atmospheric shear.'} Please re-query the array.`,
        timestamp: Date.now(),
      };

      setConversations((prev) =>
        prev.map((c) =>
          c.id === currentConvId
            ? {
                ...c,
                updatedAt: Date.now(),
                messages: [...updatedMessages, errorMessage],
              }
            : c
        )
      );
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#050507]">
      {/* Sidebar with conversation history and contact link */}
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelectConversation={(id) => setActiveId(id)}
        onNewConversation={handleNewConversation}
        onDeleteConversation={handleDeleteConversation}
        onRenameConversation={handleRenameConversation}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
      />

      {/* Main Chat Interface */}
      <ChatArea
        activeConversation={activeConversation}
        onSendMessage={handleSendMessage}
        isLoading={isLoading}
        voiceMode={voiceMode}
        voiceActivated={voiceActivated}
        onToggleVoiceMode={handleToggleVoiceMode}
        isSpeaking={isSpeaking}
        voiceStatus={voiceStatus}
        onStopSpeaking={handleStopSpeaking}
        onPlayMessageVoice={handlePlayMessageVoice}
        onOpenSidebar={() => setIsSidebarOpen(true)}
        onVoiceStatusChange={setVoiceStatus}
      />
    </div>
  );
}
