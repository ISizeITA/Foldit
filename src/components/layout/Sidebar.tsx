import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Database,
  Home,
  ScanLine,
  Settings as SettingsIcon,
  ShieldAlert,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { isElevated, relaunchAsAdmin } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { useAppStore, type Page } from "@/store/appStore";
import { useSettings } from "@/store/settingsStore";

const NAV: { page: Page; icon: LucideIcon; key: string }[] = [
  { page: "home", icon: Home, key: "nav.home" },
  { page: "scanner", icon: ScanLine, key: "nav.scanner" },
  { page: "telemetry", icon: Database, key: "nav.telemetry" },
  { page: "settings", icon: SettingsIcon, key: "nav.settings" },
];

export function Sidebar() {
  const { t, i18n } = useTranslation();
  const page = useAppStore((s) => s.page);
  const setPage = useAppStore((s) => s.setPage);
  const updateSettings = useSettings((s) => s.update);
  const [elevated, setElevated] = useState<boolean | null>(null);

  useEffect(() => {
    isElevated()
      .then(setElevated)
      .catch(() => setElevated(false));
  }, []);

  const toggleLang = () =>
    void updateSettings({ language: i18n.language === "it" ? "en" : "it" });

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-bg-surface">
      <div className="px-5 py-5">
        <h1 className="text-lg font-semibold tracking-tight text-ink-base">Foldit</h1>
        <p className="text-xs text-ink-faint">{t("app.tagline")}</p>
      </div>

      <nav className="flex flex-col gap-1 px-3">
        {NAV.map(({ page: p, icon: Icon, key }) => (
          <button
            key={p}
            onClick={() => setPage(p)}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
              page === p
                ? "bg-bg-elevated text-ink-base"
                : "text-ink-muted hover:bg-bg-panel hover:text-ink-base",
            )}
          >
            <Icon size={18} />
            {t(key)}
          </button>
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-3 border-t border-border p-3">
        {elevated ? (
          <div className="flex items-center gap-2 text-xs text-accent-save">
            <ShieldCheck size={14} />
            {t("admin.elevated")}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-xs text-accent-warn">
              <ShieldAlert size={14} />
              {t("admin.notElevated")}
            </div>
            <Button size="sm" variant="outline" onClick={() => void relaunchAsAdmin().catch(() => {})}>
              {t("admin.relaunch")}
            </Button>
          </div>
        )}
        <button
          onClick={toggleLang}
          className="self-start text-xs text-ink-faint transition-colors hover:text-ink-muted"
        >
          {i18n.language === "it" ? "IT · switch to EN" : "EN · passa a IT"}
        </button>
      </div>
    </aside>
  );
}
