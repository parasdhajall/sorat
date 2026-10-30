import React, { useState, useEffect } from "react";
import {
  getSupabaseConfig,
  saveSupabaseConfig,
  testSupabaseConnection,
  SUPABASE_SQL_SCHEMA,
} from "@/lib/supabase";
import { pushAllToSupabase, syncFromSupabase } from "@/lib/userStore";

interface DatabaseSettingsViewProps {
  onSyncComplete?: () => void;
}

export function DatabaseSettingsView({ onSyncComplete }: DatabaseSettingsViewProps) {
  const [config, setConfig] = useState(getSupabaseConfig());
  const [urlInput, setUrlInput] = useState(config.url);
  const [keyInput, setKeyInput] = useState(config.key);

  const [testing, setTesting] = useState(false);
  const [connectionResult, setConnectionResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [copiedSchema, setCopiedSchema] = useState(false);

  useEffect(() => {
    if (config.isConfigured) {
      handleTestConnection();
    }
  }, []);

  const handleTestConnection = async () => {
    setTesting(true);
    setConnectionResult(null);
    try {
      const res = await testSupabaseConnection();
      setConnectionResult(res);
    } catch (e: any) {
      setConnectionResult({ ok: false, message: e.message || "Connection failed" });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveConfig = (e: React.FormEvent) => {
    e.preventDefault();
    const res = saveSupabaseConfig(urlInput, keyInput);
    const newConfig = getSupabaseConfig();
    setConfig(newConfig);

    if (res.success && newConfig.isConfigured) {
      handleTestConnection();
    } else {
      setConnectionResult({ ok: res.success, message: res.message });
    }
  };

  const handleDisconnect = () => {
    saveSupabaseConfig("", "");
    setUrlInput("");
    setKeyInput("");
    setConfig(getSupabaseConfig());
    setConnectionResult({
      ok: true,
      message: "Disconnected from Supabase. Currently using high-speed local database.",
    });
  };

  const handlePushToSupabase = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await pushAllToSupabase();
      setSyncResult(res.message);
      if (res.success) {
        onSyncComplete?.();
      }
    } catch (e: any) {
      setSyncResult(`Error: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const handlePullFromSupabase = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await syncFromSupabase();
      setSyncResult(res.message);
      if (res.success) {
        onSyncComplete?.();
      }
    } catch (e: any) {
      setSyncResult(`Error: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleCopySchema = () => {
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(SUPABASE_SQL_SCHEMA);
      setCopiedSchema(true);
      setTimeout(() => setCopiedSchema(false), 3000);
    }
  };

  return (
    <div className="space-y-4 max-w-5xl">
      {/* Top Status Banner */}
      <div
        className={`rounded-2xl border p-4 shadow-sm transition ${
          config.isConfigured
            ? connectionResult?.ok
              ? "border-emerald-500/40 bg-emerald-500/10"
              : "border-amber-500/40 bg-amber-500/10"
            : "border-border/80 bg-card"
        }`}
      >
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-600/30 border border-emerald-500/40 grid place-items-center text-xl shrink-0">
              🗄️
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-display text-base font-black text-foreground">
                  {config.isConfigured ? "Supabase PostgreSQL Database" : "Local Database Mode"}
                </h3>
                <span
                  className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${
                    config.isConfigured
                      ? connectionResult?.ok
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                        : "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                      : "bg-muted text-muted-foreground border border-border"
                  }`}
                >
                  {config.isConfigured
                    ? connectionResult?.ok
                      ? "ONLINE • CLOUD SYNCED"
                      : "CHECKING..."
                    : "STANDALONE LOCAL DB"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {connectionResult?.message ||
                  (config.isConfigured
                    ? "Supabase credentials are configured."
                    : "Connect Supabase to store players, deposits, and bet history permanently in cloud PostgreSQL.")}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-stretch sm:self-auto">
            {config.isConfigured && (
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testing}
                className="py-1.5 px-3 rounded-xl border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 text-xs font-bold transition disabled:opacity-50"
              >
                {testing ? "Testing..." : "🔄 Test Connection"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Sync Result Banner */}
      {syncResult && (
        <div className="rounded-xl bg-primary/10 border border-primary/30 p-3 text-xs font-bold text-primary flex items-center justify-between">
          <span>{syncResult}</span>
          <button onClick={() => setSyncResult(null)} className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>
      )}

      {/* Two Column Grid: Credentials Form (Left) & Sync Actions (Right) */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        {/* Credentials Form */}
        <div className="md:col-span-7 rounded-2xl border border-border bg-card p-4 space-y-3.5 shadow-sm">
          <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
            <div className="flex items-center gap-2">
              <span className="text-lg">⚡</span>
              <h4 className="font-display text-sm font-black text-foreground">
                Supabase API Connection Details
              </h4>
            </div>
            {config.isConfigured && (
              <button
                type="button"
                onClick={handleDisconnect}
                className="text-[10px] text-destructive hover:underline font-bold"
              >
                Disconnect
              </button>
            )}
          </div>

          <form onSubmit={handleSaveConfig} className="space-y-3 text-xs">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                Project URL (VITE_SUPABASE_URL) *
              </label>
              <input
                type="url"
                required
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://your-project-id.supabase.co"
                className="w-full px-3 py-2 rounded-xl border border-input bg-background font-mono text-xs focus:border-primary focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                Project Anon Key (VITE_SUPABASE_ANON_KEY) *
              </label>
              <input
                type="password"
                required
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                className="w-full px-3 py-2 rounded-xl border border-input bg-background font-mono text-xs focus:border-primary focus:outline-none"
              />
            </div>

            <div className="pt-2 flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">
                Saved in local secure storage.
              </span>
              <button
                type="submit"
                className="py-2 px-4 rounded-xl bg-primary text-primary-foreground font-display text-xs font-black shadow-gold hover:opacity-90 transition active:scale-95"
              >
                SAVE & CONNECT DATABASE
              </button>
            </div>
          </form>
        </div>

        {/* Database Migration & Cloud Sync */}
        <div className="md:col-span-5 rounded-2xl border border-border bg-card p-4 space-y-3.5 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 border-b border-border/60 pb-2.5">
              <span className="text-lg">☁️</span>
              <h4 className="font-display text-sm font-black text-foreground">
                Cloud Sync Actions
              </h4>
            </div>

            <p className="text-xs text-muted-foreground mt-2">
              Sync all player profiles, deposits, and career bet records between your local browser database and cloud Supabase tables.
            </p>

            <div className="mt-3.5 space-y-2">
              <button
                type="button"
                onClick={handlePushToSupabase}
                disabled={!config.isConfigured || syncing}
                className="w-full py-2 px-3 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25 text-xs font-bold transition flex items-center justify-center gap-2 disabled:opacity-40"
              >
                <span>⬆️</span>
                <span>Push All Local Data to Supabase</span>
              </button>

              <button
                type="button"
                onClick={handlePullFromSupabase}
                disabled={!config.isConfigured || syncing}
                className="w-full py-2 px-3 rounded-xl bg-blue-500/15 border border-blue-500/40 text-blue-300 hover:bg-blue-500/25 text-xs font-bold transition flex items-center justify-center gap-2 disabled:opacity-40"
              >
                <span>⬇️</span>
                <span>Pull Cloud Data from Supabase</span>
              </button>
            </div>
          </div>

          <div className="pt-2 border-t border-border/60">
            <span className="text-[10px] text-muted-foreground block">
              💡 Tip: Running in Local Mode is always enabled so the app works 100% offline or online.
            </span>
          </div>
        </div>
      </div>

      {/* Supabase PostgreSQL Schema Script Box */}
      <div className="rounded-2xl border border-border bg-card p-4 space-y-3 shadow-sm">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-border/60 pb-2.5">
          <div className="flex items-center gap-2">
            <span className="text-lg">📜</span>
            <div>
              <h4 className="font-display text-sm font-black text-foreground">
                Database Tables Schema (SQL)
              </h4>
              <span className="text-[10px] text-muted-foreground block">
                Copy and paste this in Supabase Dashboard → SQL Editor → New Query → Run
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleCopySchema}
            className={`py-1.5 px-3 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm ${
              copiedSchema
                ? "bg-emerald-500 text-black font-black"
                : "bg-primary text-primary-foreground shadow-gold hover:opacity-90"
            }`}
          >
            <span>{copiedSchema ? "✓ COPIED TO CLIPBOARD" : "📋 COPY SQL SCHEMA"}</span>
          </button>
        </div>

        <pre className="p-3 rounded-xl bg-background border border-border/60 text-[11px] font-mono text-muted-foreground overflow-x-auto max-h-64 leading-relaxed select-all">
          {SUPABASE_SQL_SCHEMA}
        </pre>
      </div>
    </div>
  );
}

