import { describe, it, expect } from "vitest";
import { parseCSV } from "./csv";

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
