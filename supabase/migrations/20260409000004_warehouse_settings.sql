-- Warehouse user behavior settings (popup + inactivity timeout)
-- Stored in configuracoes (single-row global settings table)

ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS warehouse_popup_enabled      BOOLEAN   DEFAULT true,
  ADD COLUMN IF NOT EXISTS warehouse_popup_message      TEXT      DEFAULT 'It''s Monday! Please make sure inventory levels are up to date before starting your shift.',
  ADD COLUMN IF NOT EXISTS warehouse_popup_day          INTEGER   DEFAULT 1,  -- 0=Sun, 1=Mon, ... 6=Sat
  ADD COLUMN IF NOT EXISTS warehouse_inactivity_popup   INTEGER   DEFAULT 5,  -- minutes on popup day
  ADD COLUMN IF NOT EXISTS warehouse_inactivity_default INTEGER   DEFAULT 480; -- minutes on other days (8h)
