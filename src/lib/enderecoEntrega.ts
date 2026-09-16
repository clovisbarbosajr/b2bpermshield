// Opcoes do "Delivery Address" do checkout, montadas fora do componente.
//
// A opcao da CONTA (`clientes.endereco/...`) so aparece com rua, cidade, estado
// e CEP preenchidos — a mesma exigencia do "Save address", porque
// `enderecos.cidade/estado/cep` sao NOT NULL. Ficha parcial nao vira opcao; o
// cliente cadastra o endereco no checkout. Sem isso, "-" ia parar no pedido e
// nascia uma linha em `enderecos` por pedido.

// Mesmo endereco de entrega, ignorando caixa e espacos nas pontas — o reuso da
// linha da conta em `enderecos` compara os CINCO campos. Comparar so rua+cidade
// reusava a Suite errada e criava duplicata por diferenca de caixa.
export function mesmoEndereco(
  a: { logradouro?: string | null; complemento?: string | null; cidade?: string | null; estado?: string | null; cep?: string | null },
  b: { logradouro?: string | null; complemento?: string | null; cidade?: string | null; estado?: string | null; cep?: string | null },
): boolean {
  const n = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
  return n(a.logradouro) === n(b.logradouro) && n(a.complemento) === n(b.complemento)
    && n(a.cidade) === n(b.cidade) && n(a.estado) === n(b.estado) && n(a.cep) === n(b.cep);
}

export type EnderecoLinha = {
  id: string;
  logradouro: string;
  complemento?: string | null;
  cidade?: string | null;
  estado?: string | null;
  cep?: string | null;
  principal?: boolean | null;
};

export type ContaEndereco = {
  endereco?: string | null;
  endereco2?: string | null;
  cidade?: string | null;
  estado?: string | null;
  cep?: string | null;
};

export type ContaEnderecoNormalizado = {
  logradouro: string;
  complemento: string;
  cidade: string;
  estado: string;
  cep: string;
};

export const COMPANY_ADDRESS_ID = "__company__";

const s = (v: string | null | undefined) => (v ?? "").trim();

// "<rua>[, <cidade>][, <estado>][ <cep>]" — so com as partes presentes.
function rotulo(logradouro: string, cidade: string, estado: string, cep: string): string {
  const partes = [logradouro, cidade, estado].filter(Boolean).join(", ");
  return cep ? `${partes} ${cep}` : partes;
}

export function montarOpcoesDeEndereco(
  enderecos: EnderecoLinha[],
  conta: ContaEndereco | null | undefined,
): {
  opcoes: { id: string; rotulo: string }[];
  defaultId: string;
  contaEndereco: ContaEnderecoNormalizado | null;
} {
  const contaEndereco: ContaEnderecoNormalizado | null = s(conta?.endereco) && s(conta?.cidade) && s(conta?.estado) && s(conta?.cep)
    ? {
        logradouro: s(conta?.endereco),
        complemento: s(conta?.endereco2),
        cidade: s(conta?.cidade),
        estado: s(conta?.estado),
        cep: s(conta?.cep),
      }
    : null;

  const opcoes: { id: string; rotulo: string }[] = [];
  if (contaEndereco) {
    const { logradouro, cidade, estado, cep } = contaEndereco;
    opcoes.push({ id: COMPANY_ADDRESS_ID, rotulo: `Company address — ${rotulo(logradouro, cidade, estado, cep)}` });
  }
  for (const e of enderecos) {
    const base = rotulo(s(e.logradouro), s(e.cidade), s(e.estado), s(e.cep));
    opcoes.push({ id: e.id, rotulo: e.principal ? `${base} (main)` : base });
  }

  const principal = enderecos.find((e) => e.principal);
  const defaultId = principal
    ? principal.id
    : contaEndereco
      ? COMPANY_ADDRESS_ID
      : enderecos[0]?.id ?? "";

  return { opcoes, defaultId, contaEndereco };
}
