-- ========================================================================
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
    status TEXT DEFAULT 'ACTIVE' NOT NULL, -- 'ACTIVE', 'SPINNING', 'DECLARED'
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
-- Atomically locks user wallet, checks balance, deducts stake, and records bets in 1 SQL transaction
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
    -- Check if bets array is valid
    IF _bets IS NULL OR jsonb_array_length(_bets) = 0 THEN
        RAISE EXCEPTION 'Bets list cannot be empty';
    END IF;

    -- Calculate total stake
    FOR bet_item IN SELECT * FROM jsonb_array_elements(_bets)
    LOOP
        b_amt := (bet_item->>'amount')::NUMERIC(12, 2);
        IF b_amt IS NULL OR b_amt <= 0 THEN
            RAISE EXCEPTION 'Invalid bet amount on card %', bet_item->>'cardName';
        END IF;
        total_stake := total_stake + b_amt;
    END LOOP;

    -- Row-level lock on player to prevent race conditions or double-spending
    SELECT balance INTO cur_balance
    FROM public.players
    WHERE id = _user_id OR username = _user_id
    FOR UPDATE;

    IF cur_balance IS NULL THEN
        RAISE EXCEPTION 'Player account % not found', _user_id;
    END IF;

    IF cur_balance < total_stake THEN
        RAISE EXCEPTION 'Insufficient balance! Needed: ₹%, Available: ₹%', total_stake, cur_balance;
    END IF;

    -- Deduct balance atomically
    UPDATE public.players
    SET balance = balance - total_stake,
        updated_at = NOW()
    WHERE id = _user_id OR username = _user_id
    RETURNING balance INTO cur_balance;

    -- Insert individual bet items
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

    -- Update or create round turnover
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

    -- Settle all pending bets for this round
    FOR b IN SELECT * FROM public.sorat_bets WHERE round_id = _round_id AND status = 'pending' FOR UPDATE
    LOOP
        tot_turnover := tot_turnover + b.amount;
        IF b.card_index = _winning_card THEN
            -- 10X PAYOUT FOR WINNERS
            UPDATE public.sorat_bets
            SET status = 'won',
                payout = b.amount * 10
            WHERE id = b.id;

            -- Credit winner wallet
            UPDATE public.players
            SET balance = balance + (b.amount * 10),
                updated_at = NOW()
            WHERE id = b.user_id;

            tot_payout := tot_payout + (b.amount * 10);
            won_count := won_count + 1;
        ELSE
            -- LOST
            UPDATE public.sorat_bets
            SET status = 'lost',
                payout = 0.00
            WHERE id = b.id;
        END IF;
    END LOOP;

    net_profit := tot_turnover - tot_payout;

    -- Update round summary ledger
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

-- 9. PERMISSIONS & ROW LEVEL SECURITY (OPEN FOR KIOSK / LOCAL DEMO)
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
