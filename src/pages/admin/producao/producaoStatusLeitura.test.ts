import { describe, it, expect } from "vitest";
// @ts-expect-error — `tsconfig.app.json` nao inclui os tipos do Node; em execucao
// o modulo existe (vitest roda em Node). Mesma nota dos outros testes de fonte.
import { readFileSync } from "node:fs";

// TESTE DE FIACAO. As guardas moram dentro do componente de pagina e importar o
// modulo arrastaria layout, router e o cliente Supabase. O que da para afirmar
// sem montar a tela e a FORMA da leitura — que e exatamente o que uma reversao
// apaga.
//
// O QUE ELE PROTEGE, e cada item ja aconteceu neste arquivo:
//
//  1. `catch` NU no fallback de colunas. `fetchAllRows` lanca em QUALQUER erro,
//     entao um blip de rede na pagina 2 refazia a leitura sem
//     `eta_fonte`/`eta_atualizado_em`. As linhas chegavam sem a chave, o
//     `saveEdit` decide limpar a procedencia com `"eta_fonte" in editRow`, nao
//     limpava, e o selo verde "arrived" voltava sobre uma data digitada a mao.
//  2. Paginacao em `created_at DESC`. `.range()` e LIMIT/OFFSET e cada pagina e
//     um request: com DESC, uma entrada nova salva em `ProducaoEntrada` entre a
//     pagina 1 e a 2 empurra tudo e a linha do offset 999 reaparece no 1000 —
//     duplicada na tabela, contada duas vezes no Received log. As duas telas sao
//     usadas pela mesma equipe ao mesmo tempo.
//  3. Load velho sobrescrevendo load novo. Os oito handlers de mutacao terminam
//     em `load()`, que agora leva segundos; o mais antigo chegando por ultimo
//     devolvia a linha ao estado anterior, e se ele FALHASSE limpava a tela ja
//     carregada.
//  4. Estado de erro sem saida: com `erro`, `rows` e vazio e nenhum botao da
//     tela esta renderizado.
//  5. O painel de recebidos dizendo "Nothing received yet." quando a leitura
//     falhou — o proprio defeito que esta leva veio consertar, no outro painel.

const fonte = readFileSync("src/pages/admin/producao/ProducaoStatus.tsx", "utf8");

describe("ProducaoStatus: leitura paginada, fallback e concorrencia", () => {
  it("o fallback de colunas so vale para coluna inexistente", () => {
    expect(fonte, "sem o predicado, qualquer erro vira fallback")
      .toMatch(/const eColunaInexistente = /);
    expect(fonte).toMatch(/42703/);
    expect(fonte, "erro que nao e de coluna tem que subir e virar banner")
      .toMatch(/if \(!eColunaInexistente\(e\)\) throw e;/);
    expect(fonte, "`catch` sem parametro nao consegue olhar o erro")
      .not.toMatch(/\}\s*catch\s*\{[\s\S]{0,400}?COLS_BASE/);
  });

  it("pagina em created_at ASCENDENTE", () => {
    // DESC faz cada insercao nova empurrar as paginas ja lidas.
    const pag = fonte.slice(fonte.indexOf("const pagina = "), fonte.indexOf("const eColunaInexistente"));
    expect(pag).toMatch(/\.order\("created_at", \{ ascending: true \}\)/);
    expect(pag, "ASC e o que impede a linha duplicada").not.toMatch(/ascending: false/);
    expect(pag, "desempate por id para created_at igual").toMatch(/\.order\("id", \{ ascending: true \}\)/);
  });

  it("so a geracao mais recente do load escreve na tela", () => {
    expect(fonte).toMatch(/const loadSeq = useRef\(0\)/);
    expect(fonte).toMatch(/const meu = \+\+loadSeq\.current/);
    // Nos tres pontos: sucesso, erro e o carimbo de sync no fim.
    const guardas = fonte.match(/if \(meu !== loadSeq\.current\) return;/g) ?? [];
    expect(guardas.length, "faltou guardar algum caminho de escrita").toBeGreaterThanOrEqual(3);
  });

  it("o estado de erro tem saida", () => {
    const bloco = fonte.slice(fonte.indexOf("Production could not be loaded"));
    expect(bloco.slice(0, 600), "sem Retry a unica saida seria F5").toMatch(/onClick=\{\(\) => \{ setLoading\(true\); load\(\); \}\}/);
  });

  it("o Received log nao diz 'nada recebido' quando a leitura falhou", () => {
    expect(fonte).toMatch(/Could not be loaded — this is NOT an empty log/);
    expect(fonte, "a contagem do cabecalho tambem mentia").toMatch(/erro \? "—" : received\.length/);
  });
});
