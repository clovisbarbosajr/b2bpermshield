
-- Add new status values to pedido_status enum
ALTER TYPE public.pedido_status ADD VALUE IF NOT EXISTS 'submitted';
ALTER TYPE public.pedido_status ADD VALUE IF NOT EXISTS 'ready_for_pickup';
ALTER TYPE public.pedido_status ADD VALUE IF NOT EXISTS 'partial';
ALTER TYPE public.pedido_status ADD VALUE IF NOT EXISTS 'on_hold';
ALTER TYPE public.pedido_status ADD VALUE IF NOT EXISTS 'sent';
ALTER TYPE public.pedido_status ADD VALUE IF NOT EXISTS 'complete';
ALTER TYPE public.pedido_status ADD VALUE IF NOT EXISTS 'cancelled';
