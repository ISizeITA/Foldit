import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { PageHeader } from "@/components/layout/PageHeader";
import { Switch } from "@/components/ui/switch";
import { isContextMenuEnabled, setContextMenu } from "@/lib/ipc";
import { useSettings } from "@/store/settingsStore";
import type { Algorithm } from "@/types/models";

const ALGORITHMS: Algorithm[] = ["XPRESS4K", "XPRESS8K", "XPRESS16K", "LZX"];
const SELECT_CLASS =
  "rounded-md border border-border bg-bg-elevated px-2 py-1 text-sm text-ink-base outline-none";

export function SettingsPage() {
  const { t } = useTranslation();
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const [ctxMenu, setCtxMenu] = useState(false);

  useEffect(() => {
    isContextMenuEnabled()
      .then(setCtxMenu)
      .catch(() => {});
  }, []);

  const toggleCtxMenu = async (value: boolean) => {
    setCtxMenu(value);
    try {
      await setContextMenu(value);
    } catch {
      setCtxMenu(!value);
    }
  };

  return (
    <div>
      <PageHeader title={t("settings.title")} subtitle={t("settings.subtitle")} />
      <div className="flex max-w-2xl flex-col gap-4 px-8 py-6">
        <Row label={t("settings.language")} hint={t("settings.languageHint")}>
          <select
            value={settings.language}
            onChange={(e) => void update({ language: e.target.value })}
            className={SELECT_CLASS}
          >
            <option value="it">Italiano</option>
            <option value="en">English</option>
          </select>
        </Row>

        <Row label={t("settings.defaultAlgorithm")} hint={t("settings.defaultAlgorithmHint")}>
          <select
            value={settings.defaultAlgorithm}
            onChange={(e) => void update({ defaultAlgorithm: e.target.value as Algorithm })}
            className={SELECT_CLASS}
          >
            {ALGORITHMS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </Row>

        <Row label={t("settings.telemetry")} hint={t("settings.telemetryHint")}>
          <Switch
            checked={settings.telemetryEnabled}
            onChange={(v) => void update({ telemetryEnabled: v })}
          />
        </Row>

        <Row label={t("settings.contextMenu")} hint={t("settings.contextMenuHint")}>
          <Switch checked={ctxMenu} onChange={(v) => void toggleCtxMenu(v)} />
        </Row>
      </div>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 rounded-panel border border-border bg-bg-panel px-4 py-3">
      <div>
        <div className="text-sm text-ink-base">{label}</div>
        <div className="text-xs text-ink-faint">{hint}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
