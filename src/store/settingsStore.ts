import { create } from "zustand";

import i18n from "@/i18n";
import { getSettings, setSettings } from "@/lib/ipc";
import type { Settings } from "@/types/models";

const DEFAULTS: Settings = {
  defaultAlgorithm: "XPRESS8K",
  skipLowGain: true,
  telemetryEnabled: true,
  language: "it",
  customPaths: [],
};

interface SettingsStore {
  settings: Settings;
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<Settings>) => Promise<void>;
}

export const useSettings = create<SettingsStore>((set, get) => ({
  settings: DEFAULTS,
  loaded: false,
  load: async () => {
    try {
      const s = await getSettings();
      set({ settings: s, loaded: true });
      if (s.language && s.language !== i18n.language) void i18n.changeLanguage(s.language);
    } catch {
      set({ loaded: true });
    }
  },
  update: async (patch) => {
    const next = { ...get().settings, ...patch };
    set({ settings: next });
    if (patch.language) void i18n.changeLanguage(patch.language);
    try {
      await setSettings(next);
    } catch {
      /* ignore persistence errors */
    }
  },
}));
