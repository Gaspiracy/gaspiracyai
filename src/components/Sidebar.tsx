import React, { useState } from 'react';
import { Conversation } from '../types';
import {
  Plus,
  MessageSquare,
  Trash2,
  Edit2,
  Check,
  X,
  Mail,
  Flame,
  Radio,
  Search,
} from 'lucide-react';

interface SidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
  onRenameConversation: (id: string, newTitle: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  conversations,
  activeId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onRenameConversation,
  isOpen,
  onClose,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const handleStartRename = (conv: Conversation, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(conv.id);
    setEditTitle(conv.title);
  };

  const handleSaveRename = (id: string, e: React.MouseEvent | React.FormEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (editTitle.trim()) {
      onRenameConversation(id, editTitle.trim());
    }
    setEditingId(null);
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Delete this Sponge Pool session?')) {
      onDeleteConversation(id);
    }
  };

  // Filter conversations
  const filteredConversations = conversations.filter((c) =>
    c.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Group conversations by relative date
  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const groups: { [key: string]: Conversation[] } = {
    Today: [],
    Yesterday: [],
    'Previous 7 Days': [],
    Older: [],
  };

  filteredConversations.forEach((conv) => {
    const diff = now - conv.updatedAt;
    if (diff < ONE_DAY) {
      groups.Today.push(conv);
    } else if (diff < 2 * ONE_DAY) {
      groups.Yesterday.push(conv);
    } else if (diff < 7 * ONE_DAY) {
      groups['Previous 7 Days'].push(conv);
    } else {
      groups.Older.push(conv);
    }
  });

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar container */}
      <aside
        className={`fixed lg:static top-0 bottom-0 left-0 z-50 w-72 sm:w-80 bg-[#08080a] border-r border-amber-950/40 flex flex-col transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Header & Brand */}
        <div className="p-4 border-b border-amber-950/40 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img
              src="/gaspiracy-logo.jpg"
              alt="GaspiracyAI Official Logo"
              className="w-9 h-9 rounded-full border border-amber-500/40 object-cover shadow-md shadow-amber-500/20 shrink-0"
            />
            <div>
              <h1 className="text-base font-bold text-amber-100 tracking-tight flex items-center gap-1.5">
                GaspiracyAI
                <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  Pool v3
                </span>
              </h1>
              <p className="text-[11px] text-zinc-400">Created by Gaspiracy Media™</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-amber-400 rounded-md hover:bg-zinc-800/60 lg:hidden transition-colors"
            title="Close sidebar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action: Start new conversation button */}
        <div className="p-3 border-b border-amber-950/30">
          <button
            onClick={() => {
              onNewConversation();
              if (window.innerWidth < 1024) onClose();
            }}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 via-amber-600 to-orange-600 text-black font-semibold text-sm hover:from-amber-400 hover:to-orange-500 transition-all duration-200 shadow-md shadow-amber-500/20 active:scale-[0.99] cursor-pointer"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>Start new conversation</span>
          </button>

          {/* Search box if there are multiple conversations */}
          {conversations.length > 3 && (
            <div className="mt-2.5 relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                placeholder="Search conversations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-zinc-900/80 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-amber-500/60"
              />
            </div>
          )}
        </div>

        {/* Conversation history list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {conversations.length === 0 ? (
            <div className="py-12 text-center text-zinc-500 text-xs px-4">
              <Radio className="w-6 h-6 mx-auto mb-2 text-zinc-600 stroke-1" />
              <p>No active sessions.</p>
              <p className="mt-1 text-zinc-600">
                Data probes will populate here once initialized.
              </p>
            </div>
          ) : (
            Object.entries(groups).map(([groupTitle, list]) => {
              if (list.length === 0) return null;
              return (
                <div key={groupTitle} className="space-y-1">
                  <div className="px-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                    {groupTitle}
                  </div>
                  {list.map((conv) => {
                    const isActive = conv.id === activeId;
                    const isEditing = conv.id === editingId;

                    return (
                      <div
                        key={conv.id}
                        onClick={() => {
                          onSelectConversation(conv.id);
                          if (window.innerWidth < 1024) onClose();
                        }}
                        className={`group relative flex items-center justify-between px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors duration-150 ${
                          isActive
                            ? 'bg-amber-500/15 text-amber-200 border border-amber-500/30 font-medium'
                            : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/70 border border-transparent'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1 mr-2">
                          <MessageSquare
                            className={`w-4 h-4 shrink-0 ${
                              isActive ? 'text-amber-400' : 'text-zinc-600 group-hover:text-zinc-400'
                            }`}
                          />
                          {isEditing ? (
                            <form
                              onSubmit={(e) => handleSaveRename(conv.id, e)}
                              className="flex items-center gap-1 flex-1 min-w-0"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="text"
                                value={editTitle}
                                onChange={(e) => setEditTitle(e.target.value)}
                                autoFocus
                                className="w-full bg-black border border-amber-500 rounded px-1.5 py-0.5 text-xs text-amber-200 focus:outline-none"
                              />
                              <button
                                type="submit"
                                className="p-0.5 text-amber-400 hover:text-amber-300"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingId(null);
                                }}
                                className="p-0.5 text-zinc-500 hover:text-zinc-300"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </form>
                          ) : (
                            <span className="truncate text-xs sm:text-sm">{conv.title}</span>
                          )}
                        </div>

                        {!isEditing && (
                          <div className="hidden group-hover:flex items-center gap-1 shrink-0">
                            <button
                              onClick={(e) => handleStartRename(conv, e)}
                              className="p-1 text-zinc-400 hover:text-amber-400 hover:bg-zinc-800 rounded transition-colors"
                              title="Rename conversation"
                            >
                              <Edit2 className="w-3 h-3" />
                            </button>
                            <button
                              onClick={(e) => handleDelete(conv.id, e)}
                              className="p-1 text-zinc-400 hover:text-red-400 hover:bg-zinc-800 rounded transition-colors"
                              title="Delete conversation"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        {/* Sidebar Footer: Contact link for gaspiracymedia@gmail.com & Lore */}
        <div className="p-3 border-t border-amber-950/40 bg-zinc-950/60 space-y-2">
          {/* Explicit Contact link required by user prompt */}
          <a
            href="mailto:gaspiracymedia@gmail.com"
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-amber-300/90 hover:text-amber-200 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 transition-all duration-150 group"
          >
            <Mail className="w-4 h-4 text-amber-400 group-hover:scale-110 transition-transform" />
            <div className="flex flex-col min-w-0">
              <span className="truncate font-semibold">Contact Gaspiracy Media</span>
              <span className="text-[10px] text-zinc-400 truncate">gaspiracymedia@gmail.com</span>
            </div>
          </a>

          {/* Lore context badge */}
          <div className="px-2 pt-1 text-[10px] text-zinc-500 leading-tight">
            Fueled by <span className="text-amber-400/80 font-mono">Zorvathane</span> · Sponge
            Pooling active across all dimensions.
          </div>
        </div>
      </aside>
    </>
  );
};
