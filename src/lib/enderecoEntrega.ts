// Opcoes do "Delivery Address" do checkout, montadas fora do componente.
//
// O checkout so oferecia o endereco da CONTA (`clientes.endereco/cidade/...`)
// quando `endereco` E `cidade` estavam preenchidos. Cliente novo com a ficha
// preenchida mas `enderecos` vazia via "Select address" sem NENHUMA opcao e nao
// tinha como finalizar. Aqui a opcao da conta existe sempre que houver rua;
// cidade/estado/cep sao opcionais e so entram no rotulo quando presentes.

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
