import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { calculateProfitGuaranteedWinner } from "./realtime";
import { CARDS } from "./cards";

export interface SupabaseConfig {
  url: string;
  key: string;
  isConfigured: boolean;
}

const STORAGE_URL_KEY = "sorat_supabase_url";
const STORAGE_KEY_KEY = "sorat_supabase_key";

const DEFAULT_SUPABASE_URL = "https://igriqquokpzkbgxqlxhy.supabase.co";
const DEFAULT_SUPABASE_KEY = "sb_publishable_bX34LRt7UEoVoNUPl7UYnA_JCdM-0aO";

// Read from Vite environment or localStorage override (with live production default fallback)
export function getSupabaseConfig(): SupabaseConfig {
  let url = "";
  let key = "";

  if (typeof window !== "undefined") {
    url = localStorage.getItem(STORAGE_URL_KEY) || "";
    key = localStorage.getItem(STORAGE_KEY_KEY) || "";
  }

  // Fallback to Vite env variables if not set in localStorage
  if (!url) {
    url = (import.meta as any).env?.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL;
  }
  if (!key) {
    key = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_KEY;
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

export const SUPABASE_SQL_SCHEMA = `-- ========================================================================
-- SORAT CASINO ENGINE — PRODUCTION DATABASE SCHEMA FOR SUPABASE
-- Inspired by DigitJodi (parasdhajall/digitjodi) Production Architecture
-- Run this in Supabase Dashboard -> SQL Editor -> New Query -> Run
-- ========================================================================

-- 1. PLAYERS / AGENTS TABLE
CREATE TABLE IF NOT EXISTS public.players (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    phone TEXT,
    pin TEXT DEFAULT '1234' NOT NULL,
    role TEXT DEFAULT 'agent' NOT NULL,
    balance NUMERIC(12, 2) DEFAULT 0.00 NOT NULL,
    total_deposited NUMERIC(12, 2) DEFAULT 0.00 NOT NULL,
    total_withdrawn NUMERIC(12, 2) DEFAULT 0.00 NOT NULL,
    status TEXT DEFAULT 'ACTIVE' NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 2. DEPOSITS & WALLET RECHARGES LEDGER TABLE
CREATE TABLE IF NOT EXISTS public.deposits (
    id TEXT PRIMARY KEY DEFAULT ('dep_' || floor(extract(epoch from now()) * 1000)::text),
    user_id TEXT NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
    amount NUMERIC(12, 2) NOT NULL,
    date_str TEXT NOT NULL,
    time_str TEXT NOT NULL,
    note TEXT DEFAULT 'Counter Cash Recharge',
    balance_after NUMERIC(12, 2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 3. SORAT GAME ROUNDS LEDGER TABLE
CREATE TABLE IF NOT EXISTS public.sorat_rounds (
    round_id TEXT PRIMARY KEY,
    round_number INT NOT NULL,
    winning_card INT,
    winning_card_name TEXT,
    selection_reason TEXT DEFAULT '30_PERCENT_SAFE_MARGIN',
    total_turnover NUMERIC(12, 2) DEFAULT 0.00 NOT NULL,
    total_payouts NUMERIC(12, 2) DEFAULT 0.00 NOT NULL,
    house_profit NUMERIC(12, 2) DEFAULT 0.00 NOT NULL,
    status TEXT DEFAULT 'ACTIVE' NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 4. SORAT BETS ACTIVITY TABLE (Individual Card Wagers)
CREATE TABLE IF NOT EXISTS public.sorat_bets (
    id TEXT PRIMARY KEY DEFAULT ('bet_' || floor(extract(epoch from now()) * 1000)::text || '_' || floor(random() * 9000 + 1000)::text),
    user_id TEXT NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
    round_id TEXT NOT NULL,
    round_number INT NOT NULL,
    ticket_id TEXT NOT NULL,
    customer_name TEXT DEFAULT 'Customer',
    card_index INT NOT NULL CHECK (card_index >= 0 AND card_index <= 11),
    card_name TEXT NOT NULL,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 5),
    payout NUMERIC(12, 2) DEFAULT 0.00 NOT NULL,
    status TEXT DEFAULT 'pending' NOT NULL CHECK (status IN ('pending', 'won', 'lost', 'refunded')),
    date_str TEXT NOT NULL,
    time_str TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 5. INDEXES FOR LIGHTNING FAST LOOKUPS & AUDIT QUERIES
CREATE INDEX IF NOT EXISTS idx_sorat_bets_user_id ON public.sorat_bets(user_id);
CREATE INDEX IF NOT EXISTS idx_sorat_bets_round_id ON public.sorat_bets(round_id);
CREATE INDEX IF NOT EXISTS idx_sorat_bets_date_str ON public.sorat_bets(date_str);
CREATE INDEX IF NOT EXISTS idx_sorat_bets_created_at ON public.sorat_bets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deposits_user_id ON public.deposits(user_id);
CREATE INDEX IF NOT EXISTS idx_deposits_created_at ON public.deposits(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sorat_rounds_num ON public.sorat_rounds(round_number DESC);

-- 6. ATOMIC BETTING STORED PROCEDURE (DigitJodi 'place_bucket_bets' Pattern)
CREATE OR REPLACE FUNCTION public.place_sorat_bets(
    _user_id TEXT,
    _round_id TEXT,
    _round_number INT,
    _ticket_id TEXT,
    _customer_name TEXT,
    _date_str TEXT,
    _time_str TEXT,
    _bets JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    cur_balance NUMERIC(12, 2);
    total_stake NUMERIC(12, 2) := 0.00;
    bet_item JSONB;
    b_card_idx INT;
    b_card_name TEXT;
    b_amt NUMERIC(12, 2);
    inserted_count INT := 0;
BEGIN
    IF _bets IS NULL OR jsonb_array_length(_bets) = 0 THEN
        RAISE EXCEPTION 'Bets list cannot be empty';
    END IF;

    FOR bet_item IN SELECT * FROM jsonb_array_elements(_bets)
    LOOP
        b_amt := (bet_item->>'amount')::NUMERIC(12, 2);
        IF b_amt IS NULL OR b_amt <= 0 THEN
            RAISE EXCEPTION 'Invalid bet amount on card %', bet_item->>'cardName';
        END IF;
        total_stake := total_stake + b_amt;
    END LOOP;

    SELECT balance INTO cur_balance
    FROM public.players
    WHERE id = _user_id OR username = _user_id
    FOR UPDATE;

    IF cur_balance IS NULL THEN
        RAISE EXCEPTION 'Player account % not found', _user_id;
    END IF;

    IF cur_balance < total_stake THEN
        RAISE EXCEPTION 'Insufficient balance! Needed: % PTS, Available: % PTS', total_stake, cur_balance;
    END IF;

    UPDATE public.players
    SET balance = balance - total_stake,
        updated_at = NOW()
    WHERE id = _user_id OR username = _user_id
    RETURNING balance INTO cur_balance;

    FOR bet_item IN SELECT * FROM jsonb_array_elements(_bets)
    LOOP
        b_card_idx := (bet_item->>'cardIndex')::INT;
        b_card_name := bet_item->>'cardName';
        b_amt := (bet_item->>'amount')::NUMERIC(12, 2);

        INSERT INTO public.sorat_bets (
            id,
            user_id,
            round_id,
            round_number,
            ticket_id,
            customer_name,
            card_index,
            card_name,
            amount,
            payout,
            status,
            date_str,
            time_str
        ) VALUES (
            'bet_' || floor(extract(epoch from now()) * 1000)::text || '_' || floor(random() * 9000 + 1000)::text,
            _user_id,
            _round_id,
            _round_number,
            _ticket_id,
            COALESCE(_customer_name, 'Customer'),
            b_card_idx,
            b_card_name,
            b_amt,
            0.00,
            'pending',
            _date_str,
            _time_str
        );
        inserted_count := inserted_count + 1;
    END LOOP;

    INSERT INTO public.sorat_rounds (round_id, round_number, total_turnover, status)
    VALUES (_round_id, _round_number, total_stake, 'ACTIVE')
    ON CONFLICT (round_id)
    DO UPDATE SET total_turnover = public.sorat_rounds.total_turnover + total_stake;

    RETURN jsonb_build_object(
        'success', TRUE,
        'bets_count', inserted_count,
        'total_stake', total_stake,
        'new_balance', cur_balance,
        'round_id', _round_id,
        'ticket_id', _ticket_id
    );
END $$;

-- 7. ATOMIC ROUND RESULT DECLARATION & WINNER SETTLEMENT
CREATE OR REPLACE FUNCTION public.declare_sorat_round(
    _round_id TEXT,
    _winning_card INT,
    _winning_card_name TEXT,
    _selection_reason TEXT DEFAULT '30_PERCENT_PROFIT_LOCK'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    b RECORD;
    tot_payout NUMERIC(12, 2) := 0.00;
    tot_turnover NUMERIC(12, 2) := 0.00;
    net_profit NUMERIC(12, 2) := 0.00;
    won_count INT := 0;
BEGIN
    IF _winning_card < 0 OR _winning_card > 11 THEN
        RAISE EXCEPTION 'Winning card index must be between 0 and 11';
    END IF;

    FOR b IN SELECT * FROM public.sorat_bets WHERE round_id = _round_id AND status = 'pending' FOR UPDATE
    LOOP
        tot_turnover := tot_turnover + b.amount;
        IF b.card_index = _winning_card THEN
            UPDATE public.sorat_bets
            SET status = 'won',
                payout = b.amount * 9
            WHERE id = b.id;

            UPDATE public.players
            SET balance = balance + (b.amount * 9),
                updated_at = NOW()
            WHERE id = b.user_id;

            tot_payout := tot_payout + (b.amount * 9);
            won_count := won_count + 1;
        ELSE
            UPDATE public.sorat_bets
            SET status = 'lost',
                payout = 0.00
            WHERE id = b.id;
        END IF;
    END LOOP;

    net_profit := tot_turnover - tot_payout;

    INSERT INTO public.sorat_rounds (
        round_id,
        round_number,
        winning_card,
        winning_card_name,
        selection_reason,
        total_turnover,
        total_payouts,
        house_profit,
        status
    ) VALUES (
        _round_id,
        COALESCE((SELECT round_number FROM public.sorat_bets WHERE round_id = _round_id LIMIT 1), 1),
        _winning_card,
        _winning_card_name,
        _selection_reason,
        tot_turnover,
        tot_payout,
        net_profit,
        'DECLARED'
    )
    ON CONFLICT (round_id)
    DO UPDATE SET
        winning_card = _winning_card,
        winning_card_name = _winning_card_name,
        selection_reason = _selection_reason,
        total_turnover = GREATEST(public.sorat_rounds.total_turnover, tot_turnover),
        total_payouts = tot_payout,
        house_profit = GREATEST(public.sorat_rounds.total_turnover, tot_turnover) - tot_payout,
        status = 'DECLARED';

    RETURN jsonb_build_object(
        'success', TRUE,
        'round_id', _round_id,
        'winning_card', _winning_card,
        'winning_name', _winning_card_name,
        'total_turnover', tot_turnover,
        'total_payouts', tot_payout,
        'house_profit', net_profit,
        'winners_count', won_count
    );
END $$;

-- 8. DEPOSIT TO PLAYER STORED PROCEDURE
CREATE OR REPLACE FUNCTION public.deposit_to_player(
    _user_id TEXT,
    _amount NUMERIC(12, 2),
    _note TEXT DEFAULT 'Counter Cash Recharge',
    _date_str TEXT DEFAULT to_char((now() at time zone 'Asia/Kolkata'), 'YYYY-MM-DD'),
    _time_str TEXT DEFAULT to_char((now() at time zone 'Asia/Kolkata'), 'HH12:MI AM')
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    cur_balance NUMERIC(12, 2);
    tot_dep NUMERIC(12, 2);
BEGIN
    IF _amount <= 0 THEN
        RAISE EXCEPTION 'Deposit amount must be greater than 0';
    END IF;

    UPDATE public.players
    SET balance = balance + _amount,
        total_deposited = total_deposited + _amount,
        updated_at = NOW()
    WHERE id = _user_id OR username = _user_id
    RETURNING balance, total_deposited INTO cur_balance, tot_dep;

    IF cur_balance IS NULL THEN
        RAISE EXCEPTION 'Player % not found', _user_id;
    END IF;

    INSERT INTO public.deposits (
        user_id,
        amount,
        date_str,
        time_str,
        note,
        balance_after
    ) VALUES (
        _user_id,
        _amount,
        _date_str,
        _time_str,
        _note,
        cur_balance
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'amount', _amount,
        'new_balance', cur_balance,
        'total_deposited', tot_dep
    );
END $$;

-- 9. PERMISSIONS & RLS
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sorat_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sorat_bets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read/write to players" ON public.players FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public read/write to deposits" ON public.deposits FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public read/write to sorat_rounds" ON public.sorat_rounds FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public read/write to sorat_bets" ON public.sorat_bets FOR ALL USING (true) WITH CHECK (true);

GRANT ALL ON public.players TO anon, authenticated, service_role;
GRANT ALL ON public.deposits TO anon, authenticated, service_role;
GRANT ALL ON public.sorat_rounds TO anon, authenticated, service_role;
GRANT ALL ON public.sorat_bets TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.place_sorat_bets(TEXT, TEXT, INT, TEXT, TEXT, TEXT, TEXT, JSONB) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.declare_sorat_round(TEXT, INT, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.deposit_to_player(TEXT, NUMERIC, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
`;

/**
 * High-level RPC helper to atomically place bets directly into Supabase (DigitJodi pattern)
 */
export async function placeSoratBetsRpc(params: {
  userId: string;
  roundId: string;
  roundNumber: number;
  ticketId: string;
  customerName?: string | undefined;
  dateStr: string;
  timeStr: string;
  bets: { cardIndex: number; cardName: string; amount: number }[];
}): Promise<{ success: boolean; data?: any; error?: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: "Supabase not configured" };

  try {
    // 1. Resolve true players.id FIRST so RPC doesn't fail on foreign key constraint!
    let resolvedUserId = params.userId;
    try {
      const { data: pData } = await client
        .from("players")
        .select("id")
        .or(`id.eq.${params.userId},username.eq.${params.userId},username.eq.${params.userId.replace(/^@/, "")}`)
        .limit(1)
        .maybeSingle();

      if (pData?.id) {
        resolvedUserId = pData.id;
      }
    } catch {}

    const { data, error } = await client.rpc("place_sorat_bets", {
      _user_id: resolvedUserId,
      _round_id: params.roundId,
      _round_number: params.roundNumber,
      _ticket_id: params.ticketId,
      _customer_name: params.customerName || "Customer",
      _date_str: params.dateStr,
      _time_str: params.timeStr,
      _bets: params.bets,
    });

    if (!error) {
      return { success: true, data };
    }

    console.warn("place_sorat_bets RPC warning, executing resilient direct sorat_bets insert:", error.message);

    // Resilient Direct Insert: Ensure bets are NEVER lost from Supabase
    const totalStake = params.bets.reduce((s, b) => s + Number(b.amount || 0), 0);
    const nowIso = new Date().toISOString();
    const rows = params.bets.map((b, idx) => ({
      id: `bet_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
      user_id: resolvedUserId,
      round_id: params.roundId,
      round_number: params.roundNumber,
      ticket_id: params.ticketId,
      customer_name: params.customerName || "Customer",
      card_index: b.cardIndex,
      card_name: b.cardName,
      amount: b.amount,
      payout: 0,
      status: "pending",
      date_str: params.dateStr,
      time_str: params.timeStr,
      created_at: nowIso,
    }));

    const { data: insertData, error: insertError } = await client
      .from("sorat_bets")
      .insert(rows)
      .select();

    if (insertError) {
      return { success: false, error: insertError.message };
    }

    // Direct balance deduction in players table if RPC was bypassed
    try {
      const { data: pRec } = await client
        .from("players")
        .select("balance")
        .eq("id", resolvedUserId)
        .maybeSingle();

      if (pRec && typeof pRec.balance === "number") {
        await client
          .from("players")
          .update({
            balance: Math.max(0, pRec.balance - totalStake),
            updated_at: new Date().toISOString(),
          })
          .eq("id", resolvedUserId);
      }
    } catch {}

    return { success: true, data: insertData };
  } catch (e: any) {
    return { success: false, error: e.message || "Failed to place bets in Supabase" };
  }
}

/**
 * High-level RPC helper to declare round result in Supabase
 */
export async function declareSoratRoundRpc(params: {
  roundId: string;
  winningCard: number;
  winningCardName: string;
  selectionReason?: string;
}): Promise<{ success: boolean; data?: any; error?: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: "Supabase not configured" };

  try {
    const { data, error } = await client.rpc("declare_sorat_round", {
      _round_id: params.roundId,
      _winning_card: params.winningCard,
      _winning_card_name: params.winningCardName,
      _selection_reason: params.selectionReason || "30_PERCENT_PROFIT_LOCK",
    });

    // Enforce strict 9X payout directly in sorat_bets and credit winner balances
    try {
      const { data: roundBets } = await client
        .from("sorat_bets")
        .select("id, card_index, amount, user_id")
        .eq("round_id", params.roundId);

      if (roundBets && roundBets.length > 0) {
        for (const b of roundBets) {
          const isWin = Number(b.card_index) === params.winningCard;
          const status = isWin ? "won" : "lost";
          const payout = isWin ? Number(b.amount || 0) * 9 : 0;
          await client
            .from("sorat_bets")
            .update({ status, payout })
            .eq("id", b.id);

          // If winner and RPC had an error, guarantee player wallet gets credited in Supabase
          if (isWin && b.user_id && payout > 0 && error) {
            try {
              const { data: pRec } = await client
                .from("players")
                .select("balance")
                .eq("id", b.user_id)
                .maybeSingle();
              if (pRec && typeof pRec.balance === "number") {
                await client
                  .from("players")
                  .update({
                    balance: Number(pRec.balance || 0) + payout,
                    updated_at: new Date().toISOString(),
                  })
                  .eq("id", b.user_id);
              }
            } catch {}
          }
        }
      }
    } catch (dbErr) {
      console.warn("Direct 9X payout update warning:", dbErr);
    }

    if (error) return { success: false, error: error.message };
    return { success: true, data };
  } catch (e: any) {
    return { success: false, error: e.message || "Failed to declare round in Supabase" };
  }
}

/**
 * High-level RPC helper to deposit funds into player wallet in Supabase
 */
export async function depositToPlayerRpc(params: {
  userId: string;
  amount: number;
  note?: string;
  dateStr?: string;
  timeStr?: string;
}): Promise<{ success: boolean; data?: any; error?: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: "Supabase not configured" };

  try {
    const { data, error } = await client.rpc("deposit_to_player", {
      _user_id: params.userId,
      _amount: params.amount,
      _note: params.note || "Counter Cash Recharge",
      _date_str: params.dateStr,
      _time_str: params.timeStr,
    });

    if (error) return { success: false, error: error.message };
    return { success: true, data };
  } catch (e: any) {
    return { success: false, error: e.message || "Failed to deposit in Supabase" };
  }
}

/**
 * Claims a ticket in Supabase `sorat_bets` (Anti-Fraud protection)
 */
export async function claimTicketInSupabase(
  ticketId: string,
  claimedBy?: string
): Promise<{ success: boolean; updatedCount?: number; error?: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: "Supabase not configured" };

  try {
    const cleanId = ticketId.trim().replace(/^#/, "");
    const nowIso = new Date().toISOString();
    const claimTag = `[CLAIMED:${nowIso}:${claimedBy || "Counter Agent"}]`;

    // Persist claim in customer_name with claimTag (reliably persists timestamp and agent name)
    const { data, error } = await client
      .from("sorat_bets")
      .update({
        customer_name: claimTag,
      })
      .or(`ticket_id.eq.${cleanId},ticket_id.eq.#${cleanId},ticket_id.ilike.%${cleanId}%,id.eq.${cleanId}`)
      .select();

    if (error) {
      console.warn("claimTicketInSupabase warning:", error.message);
      return { success: false, error: error.message };
    }

    return { success: true, updatedCount: data?.length || 0 };
  } catch (e: any) {
    return { success: false, error: e.message || "Failed to claim ticket in Supabase" };
  }
}

/**
 * Fetches ticket audit records directly from Supabase `sorat_bets`
 */
export async function fetchTicketAuditFromSupabase(
  ticketId: string
): Promise<{ success: boolean; bets?: any[]; error?: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: "Supabase not configured" };

  try {
    const cleanId = ticketId.trim();
    const { data, error } = await client
      .from("sorat_bets")
      .select("*")
      .or(`ticket_id.eq.${cleanId},ticket_id.ilike.%${cleanId}%,id.eq.${cleanId}`);

    if (error) return { success: false, error: error.message };
    return { success: true, bets: data || [] };
  } catch (e: any) {
    return { success: false, error: e.message || "Failed to fetch ticket from Supabase" };
  }
}

/**
 * Toggles Counter Emergency Kill Switch in Supabase players table
 */
export async function toggleCounterKillSwitchRpc(
  userId: string,
  isPaused: boolean
): Promise<{ success: boolean; status?: string; error?: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: "Supabase not configured" };

  try {
    const status = isPaused ? "PAUSED" : "ACTIVE";
    const { data, error } = await client
      .from("players")
      .update({ status, updated_at: new Date().toISOString() })
      .or(`id.eq.${userId},username.eq.${userId}`)
      .select();

    if (error) return { success: false, error: error.message };
    return { success: true, status };
  } catch (e: any) {
    return { success: false, error: e.message || "Failed to toggle kill switch in Supabase" };
  }
}

export interface AgentDailyCloudSummary {
  sales: number;
  claimsPaid: number; // Total won payouts (वाटप) - strictly 9X (1 ka 9)
  unclaimedWon: number;
  totalWonPayouts: number;
  commission10: number;
  netCashToCollect: number;
  ticketsCount: number;
  tickets: any[];
  betsCount: number;
}

/**
 * Auto-settles any past pending rounds in Supabase (self-healing for network drops or app reloads)
 */
export async function autoSettlePastPendingRoundsInSupabase(): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;

  try {
    const { data: pendingBets } = await client
      .from("sorat_bets")
      .select("id, round_id, round_number, card_index, amount, user_id")
      .eq("status", "pending");

    if (!pendingBets || pendingBets.length === 0) return;

    // Current IST round number
    const epochSeconds = Math.floor(Date.now() / 1000);
    const istSeconds = epochSeconds + (5 * 3600 + 30 * 60);
    const istDate = new Date(istSeconds * 1000);
    const currentRoundNumber = istDate.getUTCHours() * 60 + istDate.getUTCMinutes() + 1;

    // Group pending bets by round_number
    const pastPendingByRound = new Map<number, any[]>();
    for (const b of pendingBets) {
      const rNum = Number(b.round_number || (b.round_id || "").replace(/\D/g, ""));
      if (rNum && rNum < currentRoundNumber) {
        const list = pastPendingByRound.get(rNum) || [];
        list.push(b);
        pastPendingByRound.set(rNum, list);
      }
    }

    for (const [rNum, rBets] of pastPendingByRound.entries()) {
      const roundId = rBets[0].round_id || `#${String(rNum).padStart(4, "0")}`;

      const { data: roundData } = await client
        .from("sorat_rounds")
        .select("winning_card, winning_card_name")
        .eq("round_number", rNum)
        .limit(1)
        .maybeSingle();

      let winner = roundData?.winning_card;
      let winnerName = roundData?.winning_card_name;

      if (winner === null || winner === undefined) {
        const cardBets: Record<number, number> = {};
        for (const b of rBets) {
          const cIdx = Number(b.card_index);
          cardBets[cIdx] = (cardBets[cIdx] || 0) + Number(b.amount || 0);
        }
        const decision = calculateProfitGuaranteedWinner(cardBets, 0, 0);
        winner = decision.winner;
        winnerName = CARDS[winner]?.name || `Card ${winner}`;
      }

      await client.from("sorat_rounds").upsert({
        round_id: roundId,
        round_number: rNum,
        winning_card: winner,
        winning_card_name: winnerName || `Card ${winner}`,
        selection_reason: "AUTO_RECOVERY_PAST_ROUND",
        status: "DECLARED",
      });

      for (const b of rBets) {
        const isWin = Number(b.card_index) === Number(winner);
        const payout = isWin ? Number(b.amount || 0) * 9 : 0;
        const status = isWin ? "won" : "lost";
        await client
          .from("sorat_bets")
          .update({ status, payout })
          .eq("id", b.id);
      }
    }
  } catch (err) {
    console.warn("Auto-settle past rounds in Supabase warning:", err);
  }
}

/**
 * Fetches all daily tickets and wagers from Supabase `sorat_bets` for an agent.
 * Groups individual bets by ticket_id into reconstructed ThermalTicket objects.
 */
export async function fetchAgentDailyTicketsAndBets(
  agentIdentifier: string,
  dateStr?: string
): Promise<{ success: boolean; data?: AgentDailyCloudSummary; error?: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: "Supabase not configured" };

  try {
    // Run self-healing background check for past unsettled rounds
    autoSettlePastPendingRoundsInSupabase().catch(() => {});

    const raw = (agentIdentifier || "").trim();
    const clean = raw.toLowerCase().replace(/^@/, "");
    const today = dateStr || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

    // Resolve all possible user IDs for this agent (id, username, etc.)
    const userIds = [raw, clean, `@${clean}`];
    try {
      const { data: pData } = await client
        .from("players")
        .select("id, username")
        .or(`id.eq.${raw},username.eq.${clean},username.eq.${raw}`)
        .limit(1)
        .maybeSingle();

      if (pData) {
        if (pData.id && !userIds.includes(pData.id)) userIds.push(pData.id);
        if (pData.username && !userIds.includes(pData.username)) userIds.push(pData.username);
      }
    } catch {}

    const orCondition = userIds.map((id) => `user_id.eq.${id}`).join(",");

    let query = client
      .from("sorat_bets")
      .select("*")
      .or(orCondition);

    if (today) {
      query = query.eq("date_str", today);
    }

    const { data: bets, error } = await query.order("created_at", { ascending: false });
    if (error) return { success: false, error: error.message };
    if (!Array.isArray(bets) || bets.length === 0) {
      return {
        success: true,
        data: {
          sales: 0,
          claimsPaid: 0,
          unclaimedWon: 0,
          totalWonPayouts: 0,
          commission10: 0,
          netCashToCollect: 0,
          ticketsCount: 0,
          tickets: [],
          betsCount: 0,
        },
      };
    }

    // Group bets by ticket_id and deduplicate by round_id
    const ticketMap = new Map<string, any[]>();
    const roundToTicketId = new Map<string, string>();

    for (const b of bets) {
      const tId = b.ticket_id || b.id;
      const rId = b.round_id || `#${b.round_number}`;

      // If this round already has an official TKT-... ticket, ignore duplicate tkt_... from older sync
      if (roundToTicketId.has(rId)) {
        const existingTId = roundToTicketId.get(rId)!;
        if (existingTId.startsWith("TKT-") && !tId.startsWith("TKT-")) {
          continue; // Skip duplicate fallback ticket for same round
        }
      }

      roundToTicketId.set(rId, tId);
      const list = ticketMap.get(tId) || [];
      list.push(b);
      ticketMap.set(tId, list);
    }

    const reconstructedTickets: any[] = [];
    let totalSales = 0;
    let totalClaimsPaid = 0;
    let totalUnclaimedWon = 0;

    // Current IST round number
    const epochSec = Math.floor(Date.now() / 1000);
    const istSec = epochSec + (5 * 3600 + 30 * 60);
    const curRound = new Date(istSec * 1000).getUTCHours() * 60 + new Date(istSec * 1000).getUTCMinutes() + 1;

    for (const [tId, tBets] of ticketMap.entries()) {
      const first = tBets[0];
      const rNum = Number(first.round_number || (first.round_id || "").replace(/\D/g, ""));
      const isPast = Boolean(rNum && rNum < curRound);

      const items = tBets.map((b) => ({
        cardIndex: Number(b.card_index),
        cardName: b.card_name,
        amount: Number(b.amount || 0),
      }));
      const totalAmount = items.reduce((s, it) => s + it.amount, 0);

      // STRICT 9X PAYOUT (1 ka 9): Any winning bet gets amount * 9. Never 10X!
      const totalPayout = tBets.reduce((s, b) => {
        const isWin = b.status === "won" || b.status === "claimed" || (b.payout && Number(b.payout) > 0);
        if (isWin) {
          const strictPayout = Number(b.amount || 0) * 9;
          return s + (strictPayout > 0 ? strictPayout : Number(b.payout || 0));
        }
        return s;
      }, 0);

      totalSales += totalAmount;

      // Detect claimed status from status, claimed_at, or [CLAIMED:ISO:AGENT] in customer_name
      const claimedBet = tBets.find(
        (b) =>
          b.status === "claimed" ||
          b.claimed_at ||
          (typeof b.customer_name === "string" && b.customer_name.includes("[CLAIMED"))
      );
      const hasClaimed = Boolean(claimedBet);

      let claimedTimestamp: number | undefined;
      let claimedByAgent: string | undefined;
      if (claimedBet) {
        if (claimedBet.claimed_at) {
          claimedTimestamp = new Date(claimedBet.claimed_at).getTime();
          claimedByAgent = claimedBet.claimed_by;
        } else if (typeof claimedBet.customer_name === "string" && claimedBet.customer_name.includes("[CLAIMED:")) {
          const match = claimedBet.customer_name.match(/\[CLAIMED:([^:]+):([^\]]+)\]/);
          if (match && match[1]) {
            claimedTimestamp = new Date(match[1]).getTime();
            claimedByAgent = match[2];
          }
        }
      }

      const hasWon = totalPayout > 0 || tBets.some((b) => b.status === "won" || (b.payout && Number(b.payout) > 0));

      let ticketStatus: "ACTIVE" | "WON" | "LOST" | "CLAIMED" = "LOST";
      if (hasClaimed) {
        ticketStatus = "CLAIMED";
        totalClaimsPaid += totalPayout;
      } else if (hasWon) {
        ticketStatus = "WON";
        totalUnclaimedWon += totalPayout;
      } else if (tBets.some((b) => b.status === "pending") && !isPast) {
        ticketStatus = "ACTIVE";
      }

      const rawCustomerName = first.customer_name || "Counter Customer";
      const cleanCustomerName = rawCustomerName.replace(/\[CLAIMED:[^\]]+\]\s*/g, "").trim() || "Counter Customer";

      reconstructedTickets.push({
        ticketId: tId,
        barcode: tId.replace(/\D/g, "").slice(-8) || "00000000",
        roundId: first.round_id,
        roundNumber: first.round_number || 0,
        timestamp: first.created_at ? new Date(first.created_at).getTime() : Date.now(),
        dateStr: first.date_str || today,
        timeStr: first.time_str || "12:00 PM",
        customerName: cleanCustomerName,
        agentName: clean,
        agentId: first.user_id,
        username: clean,
        items,
        totalAmount,
        winningPayout: totalPayout,
        status: ticketStatus,
        claimedAt: claimedTimestamp || (first.claimed_at ? new Date(first.claimed_at).getTime() : undefined),
        claimedBy: claimedByAgent || first.claimed_by,
      });
    }

    const totalWonPayouts = totalClaimsPaid + totalUnclaimedWon;
    const grossProfit = totalSales - totalWonPayouts;
    // 10% Agent Commission calculated directly on Total Sales (Turnover)
    const commission10 = totalSales > 0 ? Math.round(totalSales * 0.10) : 0;
    const netCashToCollect = totalSales - totalWonPayouts - commission10;

    return {
      success: true,
      data: {
        sales: totalSales,
        claimsPaid: totalWonPayouts, // In physical counter operations, this represents all winning payouts (Claims Paid / वाटप)
        unclaimedWon: totalUnclaimedWon,
        totalWonPayouts,
        commission10,
        netCashToCollect,
        ticketsCount: reconstructedTickets.length,
        tickets: reconstructedTickets,
        betsCount: bets.length,
      },
    };
  } catch (e: any) {
    return { success: false, error: e.message || "Failed to fetch daily hisab from Supabase" };
  }
}

/**
 * Subscribes to Supabase Realtime changes on `sorat_bets` for instant multi-device settlement updates
 */
export function subscribeToSoratBetsRealtime(onChange: () => void): () => void {
  const client = getSupabaseClient();
  if (!client) return () => {};

  try {
    const channel = client
      .channel(`sorat_bets_realtime_${Date.now()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sorat_bets" },
        () => {
          onChange();
        }
      )
      .subscribe();

    return () => {
      try {
        client.removeChannel(channel);
      } catch {}
    };
  } catch {
    return () => {};
  }
}

/**
 * Subscribes to Supabase Realtime changes on `players` table for instant balance updates across devices
 */
export function subscribeToPlayerBalanceRealtime(
  agentIdentifier: string,
  onBalanceUpdate: (newBalance: number) => void
): () => void {
  const client = getSupabaseClient();
  if (!client) return () => {};

  const clean = (agentIdentifier || "").toLowerCase().replace(/^@/, "").trim();
  if (!clean) return () => {};

  try {
    const channel = client
      .channel(`player_balance_${clean}_${Date.now()}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "players" },
        (payload: any) => {
          if (payload?.new) {
            const p = payload.new;
            const pId = (p.id || "").toLowerCase().trim();
            const pUser = (p.username || "").toLowerCase().replace(/^@/, "").trim();
            if (pId === clean || pUser === clean) {
              if (typeof p.balance === "number") {
                onBalanceUpdate(p.balance);
              } else if (p.balance !== undefined && !isNaN(Number(p.balance))) {
                onBalanceUpdate(Number(p.balance));
              }
            }
          }
        }
      )
      .subscribe();

    return () => {
      try {
        client.removeChannel(channel);
      } catch {}
    };
  } catch {
    return () => {};
  }
}




