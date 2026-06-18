CREATE OR REPLACE FUNCTION public._vault_upsert_secret(_name text, _value text, _desc text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM vault.secrets WHERE name = _name;
  IF v_id IS NULL THEN
    PERFORM vault.create_secret(_value, _name, _desc);
  ELSE
    PERFORM vault.update_secret(v_id, _value, _name, _desc);
  END IF;
END $$;

REVOKE ALL ON FUNCTION public._vault_upsert_secret(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._vault_upsert_secret(text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public._vault_secret_exists(_name text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, vault
AS $$ SELECT EXISTS (SELECT 1 FROM vault.secrets WHERE name = _name) $$;

REVOKE ALL ON FUNCTION public._vault_secret_exists(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._vault_secret_exists(text) TO service_role, authenticated;