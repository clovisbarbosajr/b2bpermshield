import { describe, it, expect } from "vitest";
import { travaDeReservadoSeAplica } from "./stock";
import { gravarComToken } from "./gravarComToken";

const base = { estoqueAtual: 10, estoqueNovo: 5, permitirBackorder: false, statusProduto: "disponivel" };

describe("travaDeReservadoSeAplica", () => {
  it("vale quando o admin BAIXA a quantidade de um produto que exige saldo", () => {
    expect(travaDeReservadoSeAplica(base)).toBe(true);
  });

  // ESTE E O ASSERT QUE JUSTIFICA A FUNCAO. `estoque_total` sempre vai no payload
  // do `ProductEdit`, entao a trava incondicional barrava o save de QUALQUER campo
  // — descricao, preco, SEO — em todo produto com `reservado > total`.
  it("NAO vale quando a quantidade nao mudou", () => {
    expect(travaDeReservadoSeAplica({ ...base, estoqueNovo: 10 })).toBe(false);
    expect(travaDeReservadoSeAplica({ ...base, estoqueAtual: 0, estoqueNovo: 0 })).toBe(false);
  });

  it("NAO vale quando a quantidade SOBE", () => {
    expect(travaDeReservadoSeAplica({ ...base, estoqueNovo: 50 })).toBe(false);
  });

  // O gatilho isenta os dois de proposito (`_enforce`), entao `reservado > total`
  // ali e o estado esperado do negocio — barrar seria a tela recusando o que o
  // banco aceita.
  it("NAO vale para backorder", () => {
    expect(travaDeReservadoSeAplica({ ...base, permitirBackorder: true })).toBe(false);
  });

  it("NAO vale para pre-venda, nas formas que o banco reconhece", () => {
    for (const s of ["pre_venda", "pre-venda", "pre-order", "Pre-Order", "encomenda"]) {
      expect(travaDeReservadoSeAplica({ ...base, statusProduto: s }), s).toBe(false);
    }
  });

  it("status normal com backorder desligado continua travando", () => {
    for (const s of ["disponivel", "esgotado", "estoque_limitado", "indisponivel", null, undefined]) {
      expect(travaDeReservadoSeAplica({ ...base, statusProduto: s }), String(s)).toBe(true);
    }
  });

  // `permitirBackorder` chega como null de linha antiga; so `true` isenta.
  it("backorder null ou undefined nao isenta", () => {
    expect(travaDeReservadoSeAplica({ ...base, permitirBackorder: null })).toBe(true);
    expect(travaDeReservadoSeAplica({ ...base, permitirBackorder: undefined })).toBe(true);
  });
});

// `porFiltroExtra` nao tinha uma linha de teste que EXECUTA: o cliente falso de
// `gravarComToken.test.ts` nem tem `.lte`. Sem isto, dois mutantes passavam verdes
// — `porFiltroExtra: true` fixo (que faz o conflito de TOKEN dizer "aumente o
// estoque", e o admin sobe a quantidade por cima do save do colega) e a inversao
// do ternario na tela.
describe("gravarComToken: `porFiltroExtra` distingue o token do filtro do chamador", () => {
  // Falso de DUAS chamadas, que e o que a funcao faz: o UPDATE, e — so quando ele
  // casa zero linhas COM filtro extra — a releitura que separa as duas causas.
  let usouLte = false;
  const falso = (opts: { casaUpdate: boolean; revAtual: number | null }) => {
    usouLte = false;
    let chamadas = 0;
    const cadeia = (ehUpdate: boolean) => {
      const api: any = {
        // `lte` MARCA. Sem isto, apagar o `if (filtroExtra) q = filtroExtra(q);` da
        // funcao passava verde: o `.lte` nunca saia no UPDATE, a corrida reabria
        // inteira, e o `porFiltroExtra` continuava sendo calculado — a tela dizia
        // "aumente a quantidade" enquanto nada tinha protegido nada. O teste cobria
        // o desfecho e nao o MECANISMO.
        update: () => api, eq: () => api,
        lte: () => { usouLte = true; return api; },
        select: () => api,
        maybeSingle: async () =>
          ehUpdate
            ? (opts.casaUpdate ? { data: { admin_rev: 8 }, error: null, status: 200 }
                               : { data: null, error: null, status: 204 })
            : { data: opts.revAtual === null ? null : { admin_rev: opts.revAtual }, error: null, status: 200 },
      };
      return api;
    };
    return { from: () => cadeia(++chamadas === 1) };
  };

  it("filtro barrou e o token continua valendo -> porFiltroExtra true", async () => {
    // UPDATE casou zero linhas, e a releitura mostra o token AINDA em 7 -> quem
    // barrou foi o filtro, e nao um colega.
    const sb = falso({ casaUpdate: false, revAtual: 7 });
    const r = await gravarComToken(sb, "produtos", "p1", { estoque_total: 5 }, 7, (q: any) => q.lte("estoque_reservado", 5));
    expect(usouLte, "o filtroExtra nao chegou ao statement — o `.lte` nao saiu no UPDATE").toBe(true);
    expect(r.tipo).toBe("conflito");
    expect((r as any).porFiltroExtra, "o filtro barrou mas a tela vai acusar um colega").toBe(true);
  });

  it("token mudou -> porFiltroExtra false, e a mensagem generica e a certa", async () => {
    // UPDATE casou zero linhas e a releitura mostra o token JA em 99 -> alguem
    // gravou no meio.
    const sb = falso({ casaUpdate: false, revAtual: 99 });
    const r = await gravarComToken(sb, "produtos", "p1", { estoque_total: 5 }, 7, (q: any) => q.lte("estoque_reservado", 5));
    expect(usouLte, "o filtroExtra nao chegou ao statement — o `.lte` nao saiu no UPDATE").toBe(true);
    expect(r.tipo).toBe("conflito");
    expect((r as any).porFiltroExtra, "conflito de token virou mensagem de estoque").toBe(false);
  });

  it("sem filtroExtra o desfecho continua sendo conflito simples", async () => {
    const sb = falso({ casaUpdate: false, revAtual: 99 });
    const r = await gravarComToken(sb, "produtos", "p1", { nome: "x" }, 7);
    expect(r.tipo).toBe("conflito");
    expect(usouLte, "chamou o filtro sem ter recebido um").toBe(false);
    expect((r as any).porFiltroExtra, "sem filtro extra nao ha o que atribuir a ele").toBeUndefined();
  });
});
