import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Download, Loader2, Sparkles, X } from "lucide-react";

const DISMISS_KEY = "foldit.updateDismissedVersion";

/**
 * Checks for a newer signed build once on startup. If found, drops a slim
 * pill at the top-centre with "Install"; dismiss is remembered per version
 * for the session. Network/signature failures keep it silently hidden.
 */
export function UpdateBanner() {
  const { t } = useTranslation();
  const [update, setUpdate] = useState<Update | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY);
    } catch {
      return null;
    }
  });
  const [installing, setInstalling] = useState(false);
  const [pct, setPct] = useState(0);
  const checkedRef = useRef(false);

  useEffect(() => {
    if (checkedRef.current) return;
    checkedRef.current = true;
    void (async () => {
      try {
        const found = await check();
        if (found) setUpdate(found);
      } catch (err) {
        console.warn("[updater] background check failed", err);
      }
    })();
  }, []);

  if (!update || dismissed === update.version) return null;

  const onInstall = async () => {
    setInstalling(true);
    setPct(0);
    try {
      let total = 0;
      let got = 0;
      await update.downloadAndInstall((e) => {
        if (e.event === "Started") {
          total = e.data.contentLength ?? 0;
        } else if (e.event === "Progress") {
          got += e.data.chunkLength;
          if (total > 0) setPct(Math.round((got / total) * 100));
        } else if (e.event === "Finished") {
          setPct(100);
        }
      });
      await relaunch();
    } catch (err) {
      console.error("[updater] install failed", err);
      setInstalling(false);
    }
  };

  const onDismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, update.version);
    } catch {
      /* ignore */
    }
    setDismissed(update.version);
  };

  return (
    <div className="fixed left-1/2 top-3 z-50 -translate-x-1/2">
      <div className="flex items-center gap-3 rounded-full border border-accent/50 bg-accent/15 px-4 py-2 text-xs shadow-lg backdrop-blur-md">
        <Sparkles size={14} className="shrink-0 text-accent" />
        <span className="text-ink-base">{t("update.available", { version: update.version })}</span>
        {installing ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-accent">
            <Loader2 size={12} className="animate-spin" />
            {t("update.installing", { pct })}
          </span>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void onInstall()}
              className="inline-flex items-center gap-1.5 rounded-full border border-accent/50 bg-accent/25 px-2.5 py-1 font-medium text-accent transition-colors hover:bg-accent/35"
            >
              <Download size={11} />
              {t("update.install")}
            </button>
            <button
              type="button"
              onClick={onDismiss}
              title={t("update.later")}
              aria-label={t("update.later")}
              className="text-ink-faint transition-colors hover:text-ink-base"
            >
              <X size={13} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
