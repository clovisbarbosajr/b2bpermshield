import { describe, it, expect } from "vitest";
import { espelharTracking, espelharContainer, normNum } from "./espelhoContainer";

// Os casos marcados com "REGRESSAO" sao bugs reais que a primeira versao do
// espelhamento tinha (uma unica funcao simetrica). Se algum voltar a passar
// espelhando, o container real do cliente e destruido em producao.

describe("normNum", () => {
  it("trata espaco, hifen e caixa como o mesmo numero", () => {
    expect(normNum("HDMU 2794405")).toBe("HDMU2794405");
    expect(normNum("hdmu-2794405")).toBe("HDMU2794405");
    expect(normNum(null)).toBe("");
  });
});

describe("espelharTracking (Container -> Tracking, no editor)", () => {
  it("preenche tracking vazio — a queixa original da dona", () => {
    expect(espelharTracking("MSCU1234567", "", null)).toBe("MSCU1234567");
  });

  it("leva o tracking junto quando ele so acompanhava o container antigo", () => {
    // Corrigir um digito do container deve arrastar o tracking que era copia.
    expect(espelharTracking("MSCU1234568", "MSCU1234567", "MSCU1234567")).toBe("MSCU1234568");
  });

  it("NAO sobrescreve um tracking digitado diferente de proposito", () => {
    expect(espelharTracking("MSCU1234568", "1Z999AA10123456784", "MSCU1234567")).toBeUndefined();
  });

  it("REGRESSAO: nao ressuscita um tracking apagado quando o container nem mudou", () => {
    // Admin apaga o tracking na lista, depois abre o editor so pra trocar a
    // quantidade. O container continua "ABC123" — o tracking tem que seguir vazio.
    expect(espelharTracking("ABC123", "", "ABC123")).toBeUndefined();
  });

  it("ignora diferenca so de formatacao no container", () => {
    expect(espelharTracking("hdmu 2794405", "", "HDMU2794405")).toBeUndefined();
  });

  it("nao faz nada com container vazio", () => {
    expect(espelharTracking("", "ABC123", "ABC123")).toBeUndefined();
    expect(espelharTracking("   ", null, null)).toBeUndefined();
  });

  it("grava o texto como foi digitado, nao o normalizado", () => {
    expect(espelharTracking("  MSCU 123-4567  ", "", null)).toBe("MSCU 123-4567");
  });
});

describe("espelharContainer (Tracking -> Container, na lista)", () => {
  it("preenche container vazio — o sentido que faltava", () => {
    expect(espelharContainer("MSCU1234567", "")).toBe("MSCU1234567");
    expect(espelharContainer("MSCU1234567", null)).toBe("MSCU1234567");
  });

  it("REGRESSAO: nunca sobrescreve container ja preenchido", () => {
    // O caso critico: o admin digita um numero de courier no Tracking da lista.
    // A lista NAO exibe a coluna Container — sobrescrever aqui apagaria o
    // container real sem ninguem ver, e congelaria o ETA daquele item.
    expect(espelharContainer("1Z999AA10123456784", "MSCU1234567")).toBeUndefined();
  });

  it("faz backfill de linha antiga: tracking salvo, container vazio", () => {
    // Sem isto a base legada nunca ganharia container — so espelharia se alguem
    // redigitasse o tracking, que ninguem vai fazer.
    expect(espelharContainer("ABC123", "")).toBe("ABC123");
  });

  it("nao faz nada ao apagar o tracking — o container fica intacto", () => {
    expect(espelharContainer("", "MSCU1234567")).toBeUndefined();
    expect(espelharContainer("   ", "MSCU1234567")).toBeUndefined();
  });

  it("container so com espaco conta como vazio", () => {
    expect(espelharContainer("ABC123", "   ")).toBe("ABC123");
  });
});

describe("sequencias completas (onde os bugs originais moravam)", () => {
  // Simula os dois campos passando pelos call sites, na ordem que o admin usa.
  const editor = (novoContainer: string, linha: { container: string; tracking: string }) => {
    const t = espelharTracking(novoContainer, linha.tracking, linha.container);
    return { container: novoContainer, tracking: t ?? linha.tracking };
  };
  const lista = (novoTracking: string, linha: { container: string; tracking: string }) => {
    const c = espelharContainer(novoTracking, linha.container);
    return { container: c ?? linha.container, tracking: novoTracking };
  };

  it("REGRESSAO B1: o Save da lista nao destroi o container real", () => {
    let l = { container: "", tracking: "" };
    l = editor("MSCU1234567", l);            // espelha: os dois ficam iguais
    expect(l).toEqual({ container: "MSCU1234567", tracking: "MSCU1234567" });
    l = lista("1Z999AA10123456784", l);      // courier no tracking
    expect(l.container).toBe("MSCU1234567"); // container REAL preservado
  });

  it("REGRESSAO B2: da pra chegar em Container X e Tracking Y diferentes", () => {
    let l = { container: "MSCU1", tracking: "MSCU1" };
    l = lista("YYY222", l);
    l = editor("XXX111", l);
    expect(l).toEqual({ container: "XXX111", tracking: "YYY222" });
  });

  it("REGRESSAO B3: editar so a quantidade nao ressuscita tracking apagado", () => {
    let l = { container: "ABC123", tracking: "ABC123" };
    l = lista("", l);                        // admin apaga o tracking
    expect(l.tracking).toBe("");
    l = editor("ABC123", l);                 // reabre o editor, container igual
    expect(l.tracking).toBe("");             // continua apagado
  });

  it("mudar o container leva o tracking vazio junto (comportamento desejado)", () => {
    // Diferente do B3: aqui o container REALMENTE mudou, entao o tracking
    // acompanha. Travado em teste porque e a fronteira dos dois casos.
    let l = { container: "ABC123", tracking: "" };
    l = editor("XYZ789", l);
    expect(l.tracking).toBe("XYZ789");
  });

  it("backfill: linha antiga so com tracking ganha container no primeiro Save", () => {
    let l = { container: "", tracking: "MSCU1234567" };
    l = lista("MSCU1234567", l);
    expect(l.container).toBe("MSCU1234567");
  });

  it("CONSEQUENCIA ACEITA: container apagado volta pelo tracking", () => {
    // Nao da pra separar isto do backfill acima — "legado nunca teve container" e
    // "admin apagou o container" sao o mesmo estado. Travado em teste para que a
    // troca seja uma DECISAO, e nao uma surpresa.
    let l = { container: "MSCU1234567", tracking: "MSCU1234567" };
    l = editor("", l);                       // admin apaga o container no editor
    expect(l.container).toBe("");
    l = lista("MSCU1234567", l);             // salva o tracking (ou clica "On the way")
    expect(l.container).toBe("MSCU1234567"); // volta
  });
});
