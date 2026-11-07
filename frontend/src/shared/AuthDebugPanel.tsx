import { useEffect, useMemo, useState } from "react";
import { authLog, clearAuthLogs, getAuthLogs, getToken, getTelegramWebApp, isAuthDebugEnabled, setAuthDebugEnabled, subscribeAuthLog } from "../api/client";

function snapshot() {
  const tg = getTelegramWebApp() as any;
  const hash = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
  return {
    hasTg: !!tg,
    initDataLen: tg?.initData?.length ?? 0,
    hasInitDataUnsafeUser: !!tg?.initDataUnsafe?.user,
    tgUserId: tg?.initDataUnsafe?.user?.id ?? null,
    hasToken: !!getToken(),
    href: window.location.href,
    hasTgWebAppDataInHash: !!hash.get("tgWebAppData"),
    platform: tg?.platform ?? null,
    version: tg?.version ?? null,
  };
}

export function AuthDebugPanel() {
  const [, bump] = useState(0);
  const [enabled, setEnabled] = useState(isAuthDebugEnabled);
  const [open, setOpen] = useState(isAuthDebugEnabled);
  const [copied, setCopied] = useState(false);
  const [snap, setSnap] = useState(snapshot);

  useEffect(() => subscribeAuthLog(() => { bump((n) => n + 1); setEnabled(isAuthDebugEnabled()); setOpen((o) => o || isAuthDebugEnabled()); }), []);
  useEffect(() => { const t = setInterval(() => setSnap(snapshot()), 1500); return () => clearInterval(t); }, []);

  const logs = getAuthLogs();
  const text = useMemo(() => JSON.stringify({ snapshot: snap, logs }, null, 2), [snap, logs]);

  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch {
      try { window.prompt("Скопируй логи:", text); } catch { /* ignore */ }
    }
  }

  function toggle() {
    const next = !enabled;
    setAuthDebugEnabled(next);
    setEnabled(next);
    setOpen(next || open);
    if (next) authLog("debug_enabled_manual");
  }

  return (
    <div style={{ marginTop: 12 }}>
      <button type="button" className="btn btn-ghost btn-block" onClick={() => enabled ? setOpen((o) => !o) : toggle()} style={{ fontSize: 12, opacity: 0.85 }}>
        {enabled ? (open ? "Скрыть отладку входа" : "Показать отладку входа") : "Включить отладку входа"}
      </button>
      {enabled && (
        <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-ghost" onClick={copy} style={{ fontSize: 12 }}>{copied ? "Скопировано" : "Скопировать логи"}</button>
          <button type="button" className="btn btn-ghost" onClick={() => { clearAuthLogs(); authLog("logs_cleared"); }} style={{ fontSize: 12 }}>Очистить</button>
          <button type="button" className="btn btn-ghost" onClick={toggle} style={{ fontSize: 12 }}>Выключить</button>
        </div>
      )}
      {enabled && open && (
        <pre style={{ marginTop: 8, maxHeight: 260, overflow: "auto", fontSize: 11, lineHeight: 1.35, whiteSpace: "pre-wrap", wordBreak: "break-word", background: "var(--soft, #f3f4f6)", padding: 10, borderRadius: 10, textAlign: "left", userSelect: "text", WebkitUserSelect: "text" } as any}>
{text}
        </pre>
      )}
    </div>
  );
}
