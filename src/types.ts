export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  audioBlobUrl?: string;
  isAudioLoading?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
}

export type VoiceStatus = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking';
