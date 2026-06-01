/**
 * Sidebar — 240px left panel with conversation list and actions.
 *
 * Contains NewChatButton, ConversationList with rename/delete context menu,
 * and SettingsButton.
 *
 * Requirements: 2.2, 5.2, 5.3, 5.4
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { Plus, Settings, Pencil, Trash2 } from "lucide-react";
import { useConversations, type Conversation } from "../../hooks/useConversations.ts";
import { cn } from "../../lib/utils.ts";

interface SidebarProps {
  onOpenSettings?: () => void;
}

export function Sidebar({ onOpenSettings }: SidebarProps) {
  const { conversations, activeId, create, select, rename, delete: deleteConversation } = useConversations();

  return (
    <aside className="flex h-full flex-col border-r border-gray-200 bg-surface dark:border-gray-700">
      {/* New Chat Button */}
      <div className="p-3">
        <button
          onClick={create}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium",
            "bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          )}
        >
          <Plus className="h-4 w-4" />
          New Chat
        </button>
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto px-2">
        {conversations.length === 0 && (
          <p className="px-3 py-4 text-xs text-foreground/50">
            No conversations yet
          </p>
        )}
        {conversations.map((conv) => (
          <ConversationItem
            key={conv.id}
            conversation={conv}
            isActive={conv.id === activeId}
            onSelect={() => select(conv.id)}
            onRename={(name) => rename(conv.id, name)}
            onDelete={() => deleteConversation(conv.id)}
          />
        ))}
      </div>

      {/* Settings Button */}
      <div className="border-t border-gray-200 p-3 dark:border-gray-700">
        <button
          onClick={onOpenSettings}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm",
            "text-foreground/70 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          )}
        >
          <Settings className="h-4 w-4" />
          Settings
        </button>
      </div>
    </aside>
  );
}

/* ─── ConversationItem ─── */

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}

function ConversationItem({
  conversation,
  isActive,
  onSelect,
  onRename,
  onDelete,
}: ConversationItemProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(conversation.name);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [contextMenu]);

  // Focus input when renaming
  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const handleRenameSubmit = useCallback(() => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== conversation.name) {
      onRename(trimmed);
    } else {
      setRenameValue(conversation.name);
    }
    setIsRenaming(false);
  }, [renameValue, conversation.name, onRename]);

  return (
    <div className="relative">
      <button
        onClick={onSelect}
        onContextMenu={handleContextMenu}
        className={cn(
          "flex w-full items-center rounded-lg px-3 py-2 text-left text-sm transition-colors",
          isActive
            ? "bg-gray-200 dark:bg-gray-700 text-foreground"
            : "text-foreground/70 hover:bg-gray-100 dark:hover:bg-gray-800"
        )}
      >
        {isRenaming ? (
          <input
            ref={inputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRenameSubmit();
              if (e.key === "Escape") {
                setRenameValue(conversation.name);
                setIsRenaming(false);
              }
            }}
            className="w-full bg-transparent outline-none text-sm"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="truncate">{conversation.name}</span>
        )}
      </button>

      {/* Context Menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          className={cn(
            "fixed z-50 min-w-[140px] rounded-lg border border-gray-200 bg-surface p-1 shadow-lg",
            "dark:border-gray-700"
          )}
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button
            onClick={() => {
              setContextMenu(null);
              setIsRenaming(true);
            }}
            className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-sm text-foreground/80 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <Pencil className="h-3.5 w-3.5" />
            Rename
          </button>
          <button
            onClick={() => {
              setContextMenu(null);
              onDelete();
            }}
            className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
