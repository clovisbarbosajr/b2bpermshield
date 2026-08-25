// So o que MUDOU vai para o UPDATE.
//
// `Profile` e `SetupApp` gravavam a LINHA INTEIRA de `configuracoes`
// (`const { id, created_at, updated_at, ...payload } = config`). Como as duas
// carregam a linha no `mount` e salvam minutos depois, qualquer coisa que outra
// tela (Email Settings, Notifications, Warehouse) tenha salvado nesse intervalo
// era sobrescrita pelo valor VELHO que elas tinham em memoria. Lost update
// classico — e silencioso, porque o UPDATE funciona.
//
// Conserto por DIFERENCA, e nao por lista de colunas permitidas: uma lista teria
// que ser mantida a cada coluna nova, e esquecer uma entrada quebra o salvamento
// daquele campo sem aviso. A diferenca nao tem o que esquecer.

const IMUTAVEIS = new Set(["id", "created_at", "updated_at"]);

/**
 * Devolve as chaves de `atual` cujo valor difere de `original`.
 * Retorna `{}` quando nada mudou — o chamador deve pular o UPDATE.
 */
export function diffConfig<T extends Record<string, any>>(
  original: T | null | undefined,
  atual: T | null | undefined,
): Partial<T> {
  if (!atual) return {};
  // Sem base de comparacao nao da para dizer o que mudou. Devolver tudo aqui
  // reintroduziria o lost update; devolver nada e o lado seguro.
  if (!original) return {};

  const saida: Record<string, any> = {};
  for (const k of Object.keys(atual)) {
    if (IMUTAVEIS.has(k)) continue;
    if (!igual(original[k], atual[k])) saida[k] = atual[k];
  }
  return saida as Partial<T>;
}

// Comparacao rasa nao serve: varias colunas sao `jsonb` e chegam como objeto,
// entao `!==` acusaria mudanca em TODA salvada e o lost update voltaria inteiro.
function igual(a: any, b: any): boolean {
  if (a === b) return true;
  // null e undefined sao a mesma coisa para o Postgres aqui.
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === "object" && typeof b === "object") {
    try {
      return JSON.stringify(ordena(a)) === JSON.stringify(ordena(b));
    } catch {
      return false; // ciclico ou nao serializavel: trata como mudado
    }
  }
  return false;
}

// Ordena chaves recursivamente para o JSON.stringify nao acusar diferenca so por
// ordem de propriedade.
function ordena(v: any): any {
  if (Array.isArray(v)) return v.map(ordena);
  if (v && typeof v === "object") {
    return Object.keys(v).sort().reduce((acc: any, k) => {
      acc[k] = ordena(v[k]);
      return acc;
    }, {});
  }
  return v;
}
