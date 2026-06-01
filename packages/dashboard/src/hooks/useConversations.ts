/**
 * useConversations — localStorage-backed conversation CRUD.
 *
 * Returns { conversations, activeId, create, select, rename, delete }.
 *
 * Requirements: 4.5, 5.1, 5.2, 5.3, 5.4, 5.5
 */

import { useState, useCallback } from "react";
import { safeGet, safeSet } from "../lib/storage.ts";

export interface Conversation {
  id: string;
  name: string;
  createdAt: string;
}

const CONVERSATIONS_KEY = "locai-conversations";
const ACTIVE_KEY = "locai-active-conversation";

function loadConversations(): Conversation[] {
  return safeGet<Conversation[]>(CONVERSATIONS_KEY, []);
}

function loadActiveId(): string | null {
  return safeGet<string | null>(ACTIVE_KEY, null);
}

function generateId(): string {
  return `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>(loadConversations);
  const [activeId, setActiveId] = useState<string | null>(loadActiveId);

  const persist = useCallback((convs: Conversation[]) => {
    safeSet(CONVERSATIONS_KEY, convs);
  }, []);

  const create = useCallback(() => {
    const newConv: Conversation = {
      id: generateId(),
      name: "New Chat",
      createdAt: new Date().toISOString(),
    };
    setConversations((prev) => {
      const next = [newConv, ...prev];
      persist(next);
      return next;
    });
    setActiveId(newConv.id);
    safeSet(ACTIVE_KEY, newConv.id);
    return newConv.id;
  }, [persist]);

  const select = useCallback((id: string) => {
    setActiveId(id);
    safeSet(ACTIVE_KEY, id);
  }, []);

  const rename = useCallback((id: string, name: string) => {
    setConversations((prev) => {
      const next = prev.map((c) => (c.id === id ? { ...c, name } : c));
      persist(next);
      return next;
    });
  }, [persist]);

  const deleteConversation = useCallback((id: string) => {
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      persist(next);
      return next;
    });
    // If deleting the active conversation, clear active
    setActiveId((prev) => {
      if (prev === id) {
        safeSet(ACTIVE_KEY, null);
        return null;
      }
      return prev;
    });
  }, [persist]);

  return {
    conversations,
    activeId,
    create,
    select,
    rename,
    delete: deleteConversation,
  };
}
