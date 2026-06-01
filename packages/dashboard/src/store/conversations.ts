/**
 * Conversation state management via useReducer.
 *
 * Manages the message arrays for each conversation, complementing
 * the useConversations hook which handles conversation metadata (CRUD).
 *
 * Actions: ADD_MESSAGE, SET_MESSAGES, CLEAR_MESSAGES
 *
 * Requirements: 4.6, 4.7, 5.1, 5.2
 */

import { useReducer, useCallback } from "react";
import type { Message } from "../hooks/useChat.ts";
import { safeGet, safeSet } from "../lib/storage.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConversationMessages {
  [conversationId: string]: Message[];
}

type ConversationAction =
  | { type: "ADD_MESSAGE"; conversationId: string; message: Message }
  | { type: "SET_MESSAGES"; conversationId: string; messages: Message[] }
  | { type: "CLEAR_MESSAGES"; conversationId: string };

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const STORAGE_PREFIX = "locai-messages-";

function loadMessages(conversationId: string): Message[] {
  return safeGet<Message[]>(`${STORAGE_PREFIX}${conversationId}`, []);
}

function persistMessages(conversationId: string, messages: Message[]): void {
  safeSet(`${STORAGE_PREFIX}${conversationId}`, messages);
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function conversationReducer(
  state: ConversationMessages,
  action: ConversationAction
): ConversationMessages {
  switch (action.type) {
    case "ADD_MESSAGE": {
      const existing = state[action.conversationId] ?? [];
      const updated = [...existing, action.message];
      persistMessages(action.conversationId, updated);
      return { ...state, [action.conversationId]: updated };
    }
    case "SET_MESSAGES": {
      persistMessages(action.conversationId, action.messages);
      return { ...state, [action.conversationId]: action.messages };
    }
    case "CLEAR_MESSAGES": {
      persistMessages(action.conversationId, []);
      return { ...state, [action.conversationId]: [] };
    }
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useConversationMessages(activeId: string | null) {
  const [state, dispatch] = useReducer(conversationReducer, {}, () => {
    // Initialize with messages for the active conversation if available
    if (!activeId) return {};
    return { [activeId]: loadMessages(activeId) };
  });

  const messages = activeId ? (state[activeId] ?? loadMessages(activeId)) : [];

  const addMessage = useCallback(
    (message: Message) => {
      if (!activeId) return;
      dispatch({ type: "ADD_MESSAGE", conversationId: activeId, message });
    },
    [activeId]
  );

  const setMessages = useCallback(
    (msgs: Message[]) => {
      if (!activeId) return;
      dispatch({ type: "SET_MESSAGES", conversationId: activeId, messages: msgs });
    },
    [activeId]
  );

  const clearMessages = useCallback(() => {
    if (!activeId) return;
    dispatch({ type: "CLEAR_MESSAGES", conversationId: activeId });
  }, [activeId]);

  return {
    messages,
    addMessage,
    setMessages,
    clearMessages,
  };
}
