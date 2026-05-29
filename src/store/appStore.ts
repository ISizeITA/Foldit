import { create } from "zustand";

export type Page = "home" | "scanner" | "telemetry" | "settings";

interface AppStore {
  page: Page;
  setPage: (page: Page) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  page: "home",
  setPage: (page) => set({ page }),
}));
