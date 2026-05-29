import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, RefreshCw, Search } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { fetchTelemetryDatabase } from "@/lib/ipc";
import { formatPercent } from "@/lib/utils";
import type { Algorithm, TelemetryEntry } from "@/types/models";

const ALGORITHMS: Algorithm[] = ["XPRESS4K", "XPRESS8K", "XPRESS16K", "LZX"];

type LoadState = "loading" | "ready" | "error";

export function TelemetryPage() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<TelemetryEntry[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [query, setQuery] = useState("");

  const load = () => {
    setState("loading");
    fetchTelemetryDatabase()
      .then((data) => {
        setEntries(data);
        setState("ready");
      })
      .catch(() => setState("error"));
  };

  useEffect(load, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? entries.filter((e) => e.name.toLowerCase().includes(q)) : entries;
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [entries, query]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t("telemetry.title")}
        subtitle={t("telemetry.subtitle")}
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={state === "loading"}>
            <RefreshCw size={16} className={state === "loading" ? "animate-spin" : undefined} />
            {t("telemetry.reload")}
          </Button>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col gap-4 px-8 py-6">
        <div className="relative max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("telemetry.search")}
            className="w-full rounded-md border border-border bg-bg-panel py-2 pl-9 pr-3 text-sm text-ink-base outline-none placeholder:text-ink-faint"
          />
        </div>

        <p className="text-xs text-ink-faint">{t("telemetry.hint")}</p>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-panel border border-border bg-bg-surface">
          {state === "loading" ? (
            <div className="flex items-center gap-2 p-8 text-sm text-ink-faint">
              <Loader2 size={16} className="animate-spin" />
              {t("telemetry.loading")}
            </div>
          ) : state === "error" ? (
            <div className="p-8 text-sm text-accent-warn">{t("telemetry.error")}</div>
          ) : entries.length === 0 ? (
            <div className="p-8 text-sm text-ink-faint">{t("telemetry.empty")}</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-sm text-ink-faint">{t("telemetry.noResults")}</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-bg-surface text-left text-xs uppercase tracking-wide text-ink-faint">
                <tr className="border-b border-border">
                  <th className="px-4 py-2">{t("telemetry.col.name")}</th>
                  {ALGORITHMS.map((a) => (
                    <th key={a} className="px-4 py-2 text-right">
                      {a}
                    </th>
                  ))}
                  <th className="px-4 py-2 text-right">{t("telemetry.col.samples")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => (
                  <tr key={entry.name} className="border-b border-border-subtle hover:bg-bg-panel/50">
                    <td className="px-4 py-2 text-ink-base">{entry.name}</td>
                    {ALGORITHMS.map((a) => {
                      const stat = entry.algorithms[a];
                      return (
                        <td key={a} className="px-4 py-2 text-right tabular-nums">
                          {stat ? (
                            <span className="text-accent-save">
                              {formatPercent(1 - stat.avgRatio)}
                            </span>
                          ) : (
                            <span className="text-ink-faint">—</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-4 py-2 text-right tabular-nums text-ink-muted">
                      {entry.samples}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
