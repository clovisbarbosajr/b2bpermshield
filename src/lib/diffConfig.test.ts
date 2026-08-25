import { describe, it, expect } from "vitest";
import { diffConfig } from "./diffConfig";

describe("diffConfig", () => {
  // VIGIA — o defeito: gravar a linha inteira apagava o que outra tela salvou.
  it("manda SO o campo alterado, nao a linha toda", () => {
    const antes = { id: "1", nome_empresa: "Zap", smtp_password: "segredo", email_from: "a@b.c" };
    const depois = { ...antes, nome_empresa: "Zap Supplies" };
    expect(diffConfig(antes, depois)).toEqual({ nome_empresa: "Zap Supplies" });
  });

  it("nao remanda campo que OUTRA tela alterou no meio do caminho", () => {
    // A tela carregou `smtp_password: "velha"`. O usuario so mexeu no nome.
    // O valor novo de smtp_password (salvo por Email Settings) nao pode ser
    // sobrescrito pelo valor velho que esta tela tem em memoria.
    const carregado = { id: "1", nome_empresa: "Zap", smtp_password: "velha" };
    const editado = { ...carregado, nome_empresa: "Outro" };
    expect(diffConfig(carregado, editado)).not.toHaveProperty("smtp_password");
  });

  it("ignora id/created_at/updated_at mesmo se diferirem", () => {
    const a = { id: "1", created_at: "x", updated_at: "y", nome_empresa: "Zap" };
    const b = { id: "2", created_at: "z", updated_at: "w", nome_empresa: "Zap" };
    expect(diffConfig(a, b)).toEqual({});
  });

  it("nao acusa mudanca em jsonb igual com ordem de chave diferente", () => {
    const a = { cfg: { b: 2, a: 1 } };
    const b = { cfg: { a: 1, b: 2 } };
    expect(diffConfig(a, b)).toEqual({});
  });

  it("ACUSA mudanca real dentro de jsonb", () => {
    expect(diffConfig({ cfg: { a: 1 } }, { cfg: { a: 2 } })).toEqual({ cfg: { a: 2 } });
  });

  it("trata null e undefined como iguais", () => {
    expect(diffConfig({ x: null } as any, { x: undefined } as any)).toEqual({});
  });

  it("sem original, nao manda nada — devolver tudo reintroduziria o lost update", () => {
    expect(diffConfig(null, { nome_empresa: "Zap" })).toEqual({});
  });

  // CONTROLE — sem estes, uma funcao que devolve `{}` sempre passaria acima
  // e o usuario nunca conseguiria salvar.
  it("PERMITE salvar varios campos de uma vez", () => {
    const a = { nome_empresa: "A", endereco: "R1", telefone_contato: "1" };
    const b = { nome_empresa: "B", endereco: "R2", telefone_contato: "1" };
    expect(diffConfig(a, b)).toEqual({ nome_empresa: "B", endereco: "R2" });
  });

  it("PERMITE limpar um campo (valor vira vazio)", () => {
    expect(diffConfig({ endereco: "R1" }, { endereco: "" })).toEqual({ endereco: "" });
  });

  it("PERMITE gravar false, que e valor legitimo e nao ausencia", () => {
    expect(diffConfig({ ativo: true }, { ativo: false })).toEqual({ ativo: false });
  });
});
