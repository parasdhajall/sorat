import { createClient, SupabaseClient } from "@supabase/supabase-js";

export interface SupabaseConfig {
  url: string;
  key: string;
  isConfigured: boolean;
}

const STORAGE_URL_KEY = "sorat_supabase_url";
const STORAGE_KEY_KEY = "sorat_supabase_key";

// Read from Vite environment or localStorage override
export function getSupabaseConfig(): SupabaseConfig {
  let url = "";
  let key = "";

  if (typeof window !== "undefined") {
    url = localStorage.getItem(STORAGE_URL_KEY) || "";
    key = localStorage.getItem(STORAGE_KEY_KEY) || "";
  }

  // Fallback to Vite env variables if not set in localStorage
  if (!url) {
    url = (import.meta as any).env?.VITE_SUPABASE_URL || "";
  }
  if (!key) {
    key = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || "";
  }

  return {
    url: url.trim(),
    key: key.trim(),
    isConfigured: Boolean(url && key && url.startsWith("http")),
  };
}

let supabaseInstance: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  const config = getSupabaseConfig();
  if (!config.isConfigured) return null;

  if (!supabaseInstance) {
    try {
      supabaseInstance = createClient(config.url, config.key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
        },
      });
    } catch (e) {
      console.error("Failed to initialize Supabase client:", e);
      return null;
    }
  }

  return supabaseInstance;
}

export function saveSupabaseConfig(url: string, key: string): { success: boolean; message: string } {
  if (typeof window === "undefined") return { success: false, message: "Window unavailable" };

  try {
    const cleanUrl = url.trim();
    const cleanKey = key.trim();

    if (!cleanUrl || !cleanKey) {
      localStorage.removeItem(STORAGE_URL_KEY);
      localStorage.removeItem(STORAGE_KEY_KEY);
      supabaseInstance = null;
      return { success: true, message: "Supabase configuration removed. Running in Local Database mode." };
    }

    if (!cleanUrl.startsWith("http://") && !cleanUrl.startsWith("https://")) {
      return { success: false, message: "Invalid Supabase URL: Must begin with https://" };
    }

    localStorage.setItem(STORAGE_URL_KEY, cleanUrl);
    localStorage.setItem(STORAGE_KEY_KEY, cleanKey);
    supabaseInstance = createClient(cleanUrl, cleanKey);

    return { success: true, message: "Supabase credentials saved successfully!" };
  } catch (e: any) {
    return { success: false, message: e.message || "Failed to save configuration" };
  }
}

export async function testSupabaseConnection(): Promise<{ ok: boolean; message: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return {
      ok: false,
      message: "Supabase credentials are not configured. Please enter your project URL and anon key.",
    };
  }

  try {
    // Attempt querying players table or generic ping
    const { error } = await client.from("players").select("id").limit(1);

    if (error) {
      // If table doesn't exist yet, it still proves auth/connection to Supabase is valid!
      if (error.code === "42P01" || error.message.includes("relation") || error.message.includes("does not exist")) {
        return {
          ok: true,
          message: "Connected to Supabase! (Tables need to be created using the SQL schema below).",
        };
      }
      return { ok: false, message: `Supabase Error (${error.code || "AUTH"}): ${error.message}` };
    }

    return { ok: true, message: "Connected to Supabase successfully! Tables are ready." };
  } catch (e: any) {
    return { ok: false, message: e.message || "Network error connecting to Supabase." };
  }
}

export const SUPABASE_SQL_SCHEMA = `-- ========================================================
-- SORAT DATABASE SCHEMA FOR SUPABASE
-- Run this in Supabase Dashboard -> SQL Editor -> New Query
-- ========================================================

-- 1. Create Players / User Accounts Table
CREATE TABLE IF NOT EXISTS public.players (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    phone TEXT,
    balance NUMERIC(12, 2) DEFAULT 0 NOT NULL,
    total_deposited NUMERIC(12, 2) DEFAULT 0 NOT NULL,
    total_withdrawn NUMERIC(12, 2) DEFAULT 0 NOT NULL,
    status TEXT DEFAULT 'ACTIVE' NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 2. Create Deposits Ledger Table
CREATE TABLE IF NOT EXISTS public.deposits (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
    amount NUMERIC(12, 2) NOT NULL,
    date_str TEXT NOT NULL,
    time_str TEXT NOT NULL,
    note TEXT,
    balance_after NUMERIC(12, 2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 3. Create Bets Activity Table (Today's, Yesterday's, and Career Bets)
CREATE TABLE IF NOT EXISTS public.bets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
    round_id TEXT NOT NULL,
    round_number INT NOT NULL,
    date_str TEXT NOT NULL,
    time_str TEXT NOT NULL,
    card_index INT NOT NULL,
    card_name TEXT NOT NULL,
    stake NUMERIC(12, 2) NOT NULL,
    winning_card_index INT,
    winning_card_name TEXT,
    payout NUMERIC(12, 2) DEFAULT 0 NOT NULL,
    is_win BOOLEAN DEFAULT FALSE NOT NULL,
    status TEXT DEFAULT 'PENDING' NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 4. Create Game Rounds Ledger Table
CREATE TABLE IF NOT EXISTS public.game_rounds (
    round_id TEXT PRIMARY KEY,
    round_number INT NOT NULL,
    winning_card INT NOT NULL,
    winning_name TEXT NOT NULL,
    total_turnover NUMERIC(12, 2) DEFAULT 0 NOT NULL,
    total_payouts NUMERIC(12, 2) DEFAULT 0 NOT NULL,
    house_profit NUMERIC(12, 2) DEFAULT 0 NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes for lightning fast lookups
CREATE INDEX IF NOT EXISTS idx_bets_user_id ON public.bets(user_id);
CREATE INDEX IF NOT EXISTS idx_bets_date_str ON public.bets(date_str);
CREATE INDEX IF NOT EXISTS idx_deposits_user_id ON public.deposits(user_id);

-- Enable Row Level Security (RLS) with open public policy for client demo
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_rounds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read/write to players" ON public.players FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public read/write to deposits" ON public.deposits FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public read/write to bets" ON public.bets FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public read/write to game_rounds" ON public.game_rounds FOR ALL USING (true) WITH CHECK (true);
`;

