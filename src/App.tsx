import { useEffect } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";

import { Sidebar } from "@/components/layout/Sidebar";
import { UpdateBanner } from "@/components/UpdateBanner";
import { onQueueExternal } from "@/lib/ipc";
import { HomePage } from "@/pages/HomePage";
import { ScannerPage } from "@/pages/ScannerPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { TelemetryPage } from "@/pages/TelemetryPage";
import { useAppStore } from "@/store/appStore";
import { useSettings } from "@/store/settingsStore";

export default function App() {
  const page = useAppStore((s) => s.page);
  const setPage = useAppStore((s) => s.setPage);
  const loadSettings = useSettings((s) => s.load);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  // A folder sent via the Explorer "Compress with Foldit" menu → show Scanner.
  useEffect(() => {
    let active = true;
    let unlisten: UnlistenFn | null = null;
    void onQueueExternal(() => setPage("scanner")).then((u) => {
      if (active) unlisten = u;
      else u();
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [setPage]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg-base text-ink-base">
      <UpdateBanner />
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        {page === "home" && <HomePage />}
        {page === "scanner" && <ScannerPage />}
        {page === "telemetry" && <TelemetryPage />}
        {page === "settings" && <SettingsPage />}
      </main>
    </div>
  );
}
