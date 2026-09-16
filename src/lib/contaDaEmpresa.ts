import { supabase } from "@/integrations/supabase/client";

export interface ContaDaEmpresa {
  id: string;
  tabela_preco_id: string | null;
  endereco: string | null;
  endereco2: string | null;
  cidade: string | null;
  estado: string | null;
  cep: string | null;
}

// A linha da EMPRESA (`accountId`). Staff/"View as" le direto; sub-login leva
// `null` da RLS (`auth.uid() = user_id`) SEM erro, e cai na RPC `minha_conta`
// (20260916160000), que so responde sobre quem chama. Nunca devolve null calado:
// preco/endereco da empresa faltando e erro, nao "sem tabela".
export async function lerContaDaEmpresa(accountId: string): Promise<ContaDaEmpresa> {
  const { data, error } = await supabase
    .from("clientes")
    .select("id, tabela_preco_id, endereco, endereco2, cidade, estado, cep")
    .eq("id", accountId)
    .maybeSingle();
  if (error) throw new Error(`Erro ao buscar conta: ${error.message}`);
  if (data) return data as ContaDaEmpresa;

  const { data: rpc, error: rpcErr } = await (supabase as any).rpc("minha_conta").maybeSingle();
  if (rpcErr) throw new Error(`Erro ao buscar conta: ${rpcErr.message}`);
  if (rpc?.id !== accountId) throw new Error("Erro ao buscar conta: could not read the company account");
  return rpc as ContaDaEmpresa;
}
