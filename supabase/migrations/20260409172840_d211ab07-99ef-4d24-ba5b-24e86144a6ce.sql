ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS warehouse_popup_enabled      BOOLEAN   DEFAULT true,
  ADD COLUMN IF NOT EXISTS warehouse_popup_message      TEXT      DEFAULT 'It''s Monday! Please make sure inventory levels are up to date before starting your shift.',
  ADD COLUMN IF NOT EXISTS warehouse_popup_day          INTEGER   DEFAULT 1,
  ADD COLUMN IF NOT EXISTS warehouse_inactivity_popup   INTEGER   DEFAULT 5,
  ADD COLUMN IF NOT EXISTS warehouse_inactivity_default INTEGER   DEFAULT 480;