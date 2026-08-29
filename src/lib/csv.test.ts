import { describe, it, expect } from "vitest";
import { parseCSV } from "./csv";
import { escaparCelulaCSV } from "./export-csv";

describe("parseCSV", () => {
  // VIGIA — o defeito: virgula DENTRO de aspas deslocava todas as colunas
  // seguintes, e o numero errado entrava como se fosse certo.
  it("nao desloca coluna quando o campo tem virgula entre aspas", () => {
    const csv = 'nome,quantidade,preco\n"Acme, Inc",5,10.50';
    expect(parseCSV(csv)).toEqual([
      { nome: "Acme, Inc", quantidade: "5", preco: "10.50" },
    ]);
  });

  it("nao desloca coluna quando ha campo VAZIO no meio", () => {
    // A regex antiga usava `[^,]+`, que nao casa campo vazio: a partir da
    // primeira celula em branco a linha inteira andava uma coluna.
    const csv = "a,b,c\n1,,3";
    expect(parseCSV(csv)).toEqual([{ a: "1", b: "", c: "3" }]);
  });

  it("entende aspas duplicadas dentro do campo", () => {
    const csv = 'nome\n"cano de 3"" polegadas"';
    expect(parseCSV(csv)).toEqual([{ nome: 'cano de 3" polegadas' }]);
  });

  it("entende quebra de linha DENTRO de um campo entre aspas", () => {
    const csv = 'nome,endereco\nAcme,"Rua A, 100\nSala 2"';
    expect(parseCSV(csv)).toEqual([
      { nome: "Acme", endereco: "Rua A, 100\nSala 2" },
    ]);
  });

  it("tira o BOM do Excel do primeiro cabecalho", () => {
    const csv = "﻿sku,nome\nABC,Cano";
    // Este teste protege o COMPORTAMENTO (a chave sai "sku"), nao a linha que
    // remove o BOM: o `trim()` do cabecalho ja removeria sozinho. Provado por
    // mutante — apagar aquela linha nao acende nada, e esta certo assim.
    expect(parseCSV(csv)[0]).toHaveProperty("sku", "ABC");
  });

  it("aceita CRLF do Windows", () => {
    expect(parseCSV("a,b\r\n1,2")).toEqual([{ a: "1", b: "2" }]);
  });

  it("normaliza o cabecalho para minusculas e sem espaco", () => {
    expect(parseCSV(" SKU , Nome \nABC,Cano")).toEqual([{ sku: "ABC", nome: "Cano" }]);
  });

  it("ignora linha totalmente em branco", () => {
    expect(parseCSV("a,b\n1,2\n\n3,4")).toEqual([
      { a: "1", b: "2" },
      { a: "3", b: "4" },
    ]);
  });

  // CONTROLE — sem estes, um leitor que devolve sempre `[]` passaria em tudo
  // acima e nenhum importador funcionaria.
  it("le um CSV simples", () => {
    expect(parseCSV("sku,qtd\nABC,3\nDEF,7")).toEqual([
      { sku: "ABC", qtd: "3" },
      { sku: "DEF", qtd: "7" },
    ]);
  });

  it("devolve vazio quando so ha cabecalho", () => {
    expect(parseCSV("a,b")).toEqual([]);
  });

  it("preserva o valor com espaco interno", () => {
    expect(parseCSV("nome\nCano de cobre")).toEqual([{ nome: "Cano de cobre" }]);
  });
});

// ---------------------------------------------------------------------------
// ASPAS NO MEIO DO CAMPO: o dado normal de um distribuidor de pisos.
//
// O parser ligava o modo aspas em QUALQUER posicao, e a partir dali engolia
// virgula e QUEBRA DE LINHA como conteudo. `12"` e `3"` sao escrita corrente, e
// o template que as telas oferecem para download e gerado sem aspas — o admin
// preenche a mao. Nove telas de importacao passam por aqui.
// ---------------------------------------------------------------------------
describe("aspas nao escapadas no meio do campo", () => {
  it("aspa IMPAR nao engole as linhas seguintes", () => {
    const linhas = parseCSV(
      'order_number,status,tracking_number\n' +
      '1001,complete,AB"123\n' +
      '1002,sent,XY456\n' +
      '1003,cancelled,ZZ789\n',
    );
    // Antes: UMA linha, com o resto do arquivo dentro do tracking_number, e a
    // tela dizendo "Updated 1 of 1 orders" em verde.
    expect(linhas, "as linhas seguintes foram engolidas").toHaveLength(3);
    expect(linhas[0].tracking_number).toBe('AB"123');
    expect(linhas[2].order_number).toBe("1003");
  });

  it("aspa PAR nao apaga as polegadas do nome", () => {
    const linhas = parseCSV('sku,nome\nT12,Tile 12" x 12"\n');
    expect(linhas[0].nome, "as polegadas sumiram do nome do produto")
      .toBe('Tile 12" x 12"');
  });

  it("CSV bem-formado continua igual — aspas NO INICIO ainda abrem campo", () => {
    const linhas = parseCSV('sku,nome\nT12,"Tile 12"" x 12"""\n');
    expect(linhas[0].nome).toBe('Tile 12" x 12"');
  });

  it("campo entre aspas com virgula e quebra de linha continua inteiro", () => {
    const linhas = parseCSV('sku,endereco\nA1,"Rua X, 100\nSala 3"\n');
    expect(linhas[0].endereco).toBe("Rua X, 100\nSala 3");
  });
});

describe("cabecalho repetido e recusado, nao silenciado", () => {
  it("coluna duplicada estoura em vez de deixar a ultima vencer", () => {
    // Antes: `{sku:"B2", nome:"Cano"}` — a primeira coluna sumia e o importador
    // gravava o valor da coluna errada, reportando sucesso.
    expect(() => parseCSV("sku,nome,sku\nA1,Cano,B2\n"))
      .toThrow(/repeated column/i);
  });

  it("coluna vazia repetida nao conta como duplicata", () => {
    expect(() => parseCSV("sku,,\nA1,x,y\n")).not.toThrow();
  });
});

describe("__linha: o numero REAL no arquivo", () => {
  it("linha em branco no meio nao desalinha o numero reportado", () => {
    // As telas reportavam `i + 2`, mandando o admin abrir a linha errada num CSV
    // vindo do Excel — que gosta de linha em branco.
    const linhas = parseCSV("order_number,status\n1001,sent\n\n1003,complete\n");
    expect(linhas).toHaveLength(2);
    expect((linhas[0] as any).__linha).toBe(2);
    expect((linhas[1] as any).__linha, "1003 esta na linha 4 do arquivo").toBe(4);
  });

  it("`__linha` nao aparece nas colunas do registro", () => {
    // Nao pode virar coluna: os importadores iteram as chaves do objeto.
    const linhas = parseCSV("sku\nA1\n");
    expect(Object.keys(linhas[0])).toEqual(["sku"]);
    expect(JSON.stringify(linhas[0])).not.toContain("__linha");
  });
});

describe("__linha com campo multilinha", () => {
  it("quebra DENTRO de aspas conta para o numero do arquivo", () => {
    // `ImportAddresses` e justamente a tela com endereco em duas linhas. Sem
    // contar essa quebra, tudo dali em diante apontava para a linha errada — o
    // defeito que o `__linha` veio consertar, por outra porta.
    const linhas = parseCSV('a,b\n1,"p\nq"\n2,z\n3,w\n');
    expect(linhas.map((l: any) => l.__linha)).toEqual([2, 4, 5]);
  });

  it("linha em branco e campo multilinha juntos", () => {
    const linhas = parseCSV('a,b\n1,"p\nq"\n\n3,w\n');
    expect(linhas.map((l: any) => l.__linha)).toEqual([2, 5]);
  });
});

// ---------------------------------------------------------------------------
// IDA E VOLTA: o que o export marca, a entrada desmarca.
//
// `escaparCelulaCSV` poe `'` na frente de celula que comecaria com `= + - @` —
// convencao do Excel, que o consome ao exibir. Quem reimporta o arquivo SEM
// passar pelo Excel (o ciclo que `Ferramentas.tsx` descreve como normal) recebia
// o apostrofo literal e o gravava no banco.
//
// A tentativa de resolver no EXPORT (nao prefixar telefone) era pior: sem o
// apostrofo o Excel AVALIA `+1-800-555-0100` como `1-800-555-100` = -1454.
// ---------------------------------------------------------------------------
describe("round-trip export -> import", () => {
  const roundTrip = (valor: string) => {
    const linha = `campo
${escaparCelulaCSV(valor)}
`;
    return parseCSV(linha)[0].campo;
  };

  it("telefone volta EXATAMENTE como saiu", () => {
    for (const tel of ["+1 786 555 0100", "+1-800-555-0100", "+55 (11) 98765-4321"]) {
      expect(roundTrip(tel), `nao voltou limpo: ${tel}`).toBe(tel);
    }
  });

  it("negativo e codigo de produto voltam inteiros", () => {
    for (const v of ["-10", "-1234.56", "-NN-01", "@interno", "=A1"]) {
      expect(roundTrip(v), `nao voltou limpo: ${v}`).toBe(v);
    }
  });

  it("texto normal atravessa sem ganhar nem perder nada", () => {
    for (const v of ["Nextgen Flooring", 'Tile 12" x 12"', "Rua X, 100", "3-M"]) {
      expect(roundTrip(v)).toBe(v);
    }
  });

  // O PAR TEM QUE SER INJETIVO. Sem o `'` na lista do export, celula que JA
  // comeca com apostrofo saia sem marca e a entrada desmarcava assim mesmo:
  // `'=SUM(A1)` digitado a mao no Excel virava `=SUM(A1)` no banco.
  it("apostrofo do USUARIO sobrevive, mesmo antes de caractere perigoso", () => {
    for (const v of ["'=SUM(A1)", "'-10", "'+1 786 555 0100", "'@user", "'	tab", "''=x", "'"]) {
      expect(roundTrip(v), `perdeu o apostrofo: ${JSON.stringify(v)}`).toBe(v);
    }
  });

  // A remocao e CIRURGICA: so desfaz o que o export marcou.
  it("apostrofo que e DADO nao e comido", () => {
    expect(roundTrip("'Casa do Piso'")).toBe("'Casa do Piso'");
    expect(parseCSV('campo\n"\'Casa do Piso\'"\n')[0].campo).toBe("'Casa do Piso'");
  });
});

// ---------------------------------------------------------------------------
// FIM DE LINHA EM TODAS AS FORMAS.
//
// FORA das aspas o parser trata `\r` sozinho como terminador; DENTRO delas, a
// contagem de `__linha` ignorava o CR nu. De cada um em diante, tudo desalinhava
// 1 — e nenhum teste pegava, porque os casos de `__linha` usavam so `\n`.
// (Arquivo de Excel para Mac classico usa CR sozinho.)
// ---------------------------------------------------------------------------
describe("__linha com CR, LF e CRLF", () => {
  it("CRLF dentro de aspas conta UMA linha, nao duas", () => {
    const linhas = parseCSV('a,b\r\n1,"p\r\nq"\r\n2,z\r\n');
    expect(linhas.map((l: any) => l.__linha)).toEqual([2, 4]);
  });

  it("CR nu dentro de aspas conta linha", () => {
    const linhas = parseCSV('a,b\n1,"p\rq"\n2,z\n');
    expect(linhas.map((l: any) => l.__linha)).toEqual([2, 4]);
  });

  it("arquivo inteiro em CR (Mac classico)", () => {
    const linhas = parseCSV('a,b\r1,x\r2,y\r');
    expect(linhas.map((l: any) => l.__linha)).toEqual([2, 3]);
  });

  it("CR no fim do arquivo nao inventa linha", () => {
    const linhas = parseCSV('a,b\n1,x\r');
    expect(linhas).toHaveLength(1);
    expect((linhas[0] as any).__linha).toBe(2);
  });

  it("duas quebras no mesmo campo", () => {
    const linhas = parseCSV('a,b\n1,"p\nq\nr"\n2,z\n');
    expect(linhas.map((l: any) => l.__linha)).toEqual([2, 5]);
  });
});
