import { describe, it, expect } from "vitest";
import { paraInstanteLocal, soDataLocal } from "./dataLocal";

// Testes que EXECUTAM. A versão inline destas funções (dentro de `Coupons.tsx`)
// não podia ser testada assim, e o teste que existia casava o TEXTO da fonte —
// com isso, TRÊS mutantes passavam com a suíte inteira verde:
//
//   * `new Date(iso)` → `new Date()`  — todo Edit de cupom reescreveria as duas
//     datas para HOJE;
//   * `getMonth() + 1` → `getMonth()` — mês sempre um a menos;
//   * `getDate()` → `getDate() + 1`   — a deriva de um dia, reintroduzida.
//
// Cada um deles falha aqui.

describe("paraInstanteLocal", () => {
  it("data de calendário vira instante, e volta igual", () => {
    const ida = paraInstanteLocal("2026-08-10", "23:59:59")!;
    expect(soDataLocal(ida), "a volta não desfez o que a ida fez").toBe("2026-08-10");
  });

  it("o instante gerado é MESMO o fim do dia local", () => {
    const d = new Date(paraInstanteLocal("2026-08-10", "23:59:59")!);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth() + 1).toBe(8);
    expect(d.getDate()).toBe(10);
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(59);
    expect(d.getSeconds()).toBe(59);
  });

  it("e o início é 00:00 local, não do dia anterior", () => {
    const d = new Date(paraInstanteLocal("2026-08-10", "00:00:00")!);
    expect(d.getDate(), "o cupom passaria a valer na véspera").toBe(10);
    expect(d.getHours()).toBe(0);
  });

  it("vazio e inválido viram `null`, não `Invalid Date` no banco", () => {
    expect(paraInstanteLocal("", "00:00:00")).toBeNull();
    expect(paraInstanteLocal(null, "00:00:00")).toBeNull();
    expect(paraInstanteLocal(undefined, "00:00:00")).toBeNull();
    expect(paraInstanteLocal("lixo", "00:00:00")).toBeNull();
    expect(paraInstanteLocal("2026-13-45", "00:00:00")).toBeNull();
  });
});

describe("soDataLocal", () => {
  it("lê o instante no fuso LOCAL, não em UTC", () => {
    // `toISOString().split("T")[0]` daria o dia errado a oeste de UTC. Este caso
    // é o que pegava: fim do dia local, que em UTC-N já é o dia seguinte.
    const fim = paraInstanteLocal("2026-08-10", "23:59:59")!;
    expect(soDataLocal(fim)).toBe("2026-08-10");
    expect(soDataLocal(fim), "voltou a cortar a string UTC")
      .not.toBe(fim.split("T")[0]);
  });

  it("mês e dia com dois dígitos", () => {
    const d = paraInstanteLocal("2026-01-05", "12:00:00")!;
    expect(soDataLocal(d)).toBe("2026-01-05");
  });

  it("vazio e inválido viram string vazia", () => {
    expect(soDataLocal(null)).toBe("");
    expect(soDataLocal(undefined)).toBe("");
    expect(soDataLocal("")).toBe("");
    expect(soDataLocal("lixo")).toBe("");
  });
});

describe("ida e volta NÃO deriva — era a deriva cumulativa do cupom", () => {
  // Reabrir o cupom mostrava um dia a mais, e como o diálogo salvava aquilo de
  // volta, cada Edit+Save empurrava o fim mais um dia.
  it("dez ciclos salvar→ler→salvar não movem a data", () => {
    for (const hora of ["00:00:00", "23:59:59", "12:00:00"]) {
      let data = "2026-08-10";
      for (let i = 0; i < 10; i++) {
        data = soDataLocal(paraInstanteLocal(data, hora)!);
      }
      expect(data, `derivou em ${hora}`).toBe("2026-08-10");
    }
  });

  it("estável na virada de mês, de ano e no 29 de fevereiro", () => {
    for (const data of ["2026-01-01", "2026-12-31", "2028-02-29", "2026-03-01"]) {
      for (const hora of ["00:00:00", "23:59:59"]) {
        expect(soDataLocal(paraInstanteLocal(data, hora)!), `${data} ${hora}`).toBe(data);
      }
    }
  });

  it("um ano inteiro de datas, nas duas horas, sem uma única deriva", () => {
    // Varre 2026 dia a dia: pega qualquer transição de horário de verão do fuso
    // em que a suíte estiver rodando.
    const inicio = new Date(2026, 0, 1);
    let derivou: string[] = [];
    for (let i = 0; i < 365; i++) {
      const d = new Date(inicio);
      d.setDate(inicio.getDate() + i);
      const data = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      for (const hora of ["00:00:00", "23:59:59"]) {
        const volta = soDataLocal(paraInstanteLocal(data, hora)!);
        if (volta !== data) derivou.push(`${data} ${hora} -> ${volta}`);
      }
    }
    expect(derivou, "datas que não sobreviveram ao round-trip").toEqual([]);
  });
});
