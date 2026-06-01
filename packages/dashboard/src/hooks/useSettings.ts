/**
 * useSettings — localStorage-backed settings with no server calls.
 *
 * Returns { settings, update }.
 * Defaults: goal "balanced", maxTokens 0, temperature 0.7,
 *           contextLength 4096, serverUrl "http://localhost:8080"
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 17.2, 17.3
 */

import { useState, useCallback } from "react";
import { safeGet, safeSet } from "../lib/storage.ts";

export interface Settings {
  serverUrl: string;
  goal: "quality" | "speed" | "balanced";
  maxTokens: number;
  temperature: number;
  contextLength: number;
}

const STORAGE_KEY = "locai-settings";

const DEFAULTS: Settings = {
  serverUrl: "http://localhost:8080",
  goal: "balanced",
  maxTokens: 0,
  temperature: 0.7,
  contextLength: 4096,
};

function loadSettings(): Settings {
  const stored = safeGet<Partial<Settings>>(STORAGE_KEY, {});
  return { ...DEFAULTS, ...stored };
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(loadSettings);

  const update = useCallback((partial: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      safeSet(STORAGE_KEY, next);
      // Also persist serverUrl separately for the api client to read
      if (partial.serverUrl !== undefined) {
        safeSet("locai-settings-serverUrl", partial.serverUrl);
      }
      return next;
    });
  }, []);

  return { settings, update };
}
