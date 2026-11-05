import React, { useState, useEffect, useCallback } from 'react';
import { Conversation, Message, VoiceStatus } from './types';
import { Sidebar } from './components/Sidebar';
import { ChatArea } from './components/ChatArea';
import { audioManager } from './utils/audio';

const STORAGE_KEY_CONVERSATIONS = 'gaspiracy_conversations_v2';
const STORAGE_KEY_ACTIVE_ID = 'gaspiracy_active_id_v2';
const STORAGE_KEY_VOICE_MODE = 'gaspiracy_voice_mode_v2';

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

  // Default Voice Mode to true for direct voice-to-voice experience
  const [voiceMode, setVoiceMode] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_VOICE_MODE);
      return stored !== null ? JSON.parse(stored) : true;
    } catch {
      return true;
    }
  });

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
        setVoiceStatus(voiceMode ? 'listening' : 'idle');
      }
    });

    return () => {
      unsubscribe();
      audioManager.stop();
    };
  }, [voiceMode]);

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
    const nextMode = !voiceMode;
    setVoiceMode(nextMode);
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
    setVoiceStatus(voiceMode ? 'listening' : 'idle');
  };

  const handlePlayMessageVoice = async (message: Message) => {
    if (isSpeaking) {
      audioManager.stop();
      return;
    }

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

    try {
      // Call server Gemini chat endpoint
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
      const assistantReply = data.reply || 'The Sponge Pool returned an anomalous silence.';

      const assistantMessage: Message = {
        id: `msg_a_${Date.now()}`,
        role: 'assistant',
        content: assistantReply,
        timestamp: Date.now(),
      };

      const finalMessages = [...updatedMessages, assistantMessage];

      // Immediately render the assistant text on screen
      setConversations((prev) =>
        prev.map((c) =>
          c.id === currentConvId
            ? {
                ...c,
                updatedAt: Date.now(),
                messages: finalMessages,
              }
            : c
        )
      );

      setIsLoading(false);

      // In Voice Mode, start speaking immediately with Cartesia TTS and await completion
      if (voiceMode) {
        setVoiceStatus('speaking');
        try {
          await audioManager.playText(
            assistantReply,
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
          setVoiceStatus('listening');
        } catch (ttsErr) {
          console.warn('Voice auto-play error:', ttsErr);
          setVoiceStatus('listening');
        }
      } else {
        setVoiceStatus('idle');
      }
    } catch (err: any) {
      console.error('Chat error:', err);
      setIsLoading(false);
      setVoiceStatus(voiceMode ? 'listening' : 'idle');

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
