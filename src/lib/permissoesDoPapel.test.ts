import { describe, it, expect } from "vitest";
// @ts-expect-error — `tsconfig.app.json` nao inclui os tipos do Node; em execucao
// o modulo existe (vitest roda em Node).
import { readFileSync } from "node:fs";
import { DEFAULT_PERMISSIONS } from "./permissions";
import { permissoesDoPapel } from "./permissoesDoPapel";

// A funcao vem de `src/lib/permissoesDoPapel.ts` — o CODIGO DE PRODUCAO.
//
// A primeira versao deste arquivo REIMPLEMENTAVA a regra aqui dentro, porque ela
// morava no `AuthContext` (que arrasta o cliente Supabase e o router). O teste
// exercitava a copia, e conferia o arquivo real so por `toContain` de duas
// linhas. Resultado: inverter o merge no codigo de producao para
// `{...mapa, ...padrao}` — o que faz desmarcar um checkbox deixar de valer, ou
// seja o proprio bug que a funcao veio consertar — passava VERDE. Mover a funcao
// para `lib` foi a correcao; duplica-la de novo aqui desfaz tudo.
//
// O QUE ELA PROTEGE: `user_roles.permissions` e `JSONB DEFAULT '{}'`
// (20260410000001) e os `DEFAULT_PERMISSIONS` so eram aplicados dentro da TELA de
// Users, na hora de editar. Quem nunca passou por ela chegava no `AuthContext`
// com `{}` — e como `hasPermission` testa `permissions[key] === true`, tudo virava
// false. Enquanto as permissoes so escondiam menu isso dava um menu vazio; agora
// que elas tambem fecham rota, trancaria o operador para fora do sistema inteiro.

describe("permissoesDoPapel", () => {
  it("mapa VAZIO cai no default do papel — nao em 'pode nada'", () => {
    const w = permissoesDoPapel("warehouse", {});
    expect(w.view_orders, "warehouse sem mapa ficaria sem menu nenhum").toBe(true);
    expect(w.view_products).toBe(true);
    expect(w.view_users_management, "e o default continua negando o que nega").toBe(false);
  });

  it("null e undefined valem como vazio", () => {
    expect(permissoesDoPapel("manager", null).view_orders).toBe(true);
    expect(permissoesDoPapel("manager", undefined).view_orders).toBe(true);
  });

  it("escolha explicita do admin VENCE o default", () => {
    // Uma chave gravada ja significa "este admin configurou este usuario".
    const w = permissoesDoPapel("warehouse", { view_orders: false });
    expect(w.view_orders, "desmarcar tem que valer, senao o checkbox nao serve").toBe(false);
    // E as chaves que ele nao mexeu seguem o default do papel.
    expect(w.view_products).toBe(true);
  });

  it("admin nao usa mapa — nao ha default para ele", () => {
    // `hasPermission` ja devolve true para admin antes de olhar o mapa; aqui so
    // se garante que a funcao nao inventa um default inexistente.
    expect(permissoesDoPapel("admin", {})).toEqual({});
    expect(permissoesDoPapel("admin", { x: true })).toEqual({ x: true });
  });

  it("papel desconhecido devolve o que veio, sem inventar permissao", () => {
    expect(permissoesDoPapel("outro", { view_orders: true })).toEqual({ view_orders: true });
    expect(permissoesDoPapel("outro", {})).toEqual({});
  });
});

describe("fiacao: o AuthContext e as rotas", () => {
  const auth = readFileSync("src/contexts/AuthContext.tsx", "utf8");
  const app = readFileSync("src/App.tsx", "utf8");

  it("o AuthContext resolve o mapa pelo papel, usando a lib", () => {
    expect(auth, "sem isto, staff com `{}` fica sem permissao nenhuma")
      .toContain("setPermissions(permissoesDoPapel(dbRole, (data as any).permissions))");
    expect(auth).toContain('import { permissoesDoPapel } from "@/lib/permissoesDoPapel"');
    // Reimplementar a regra dentro do contexto e o que deixava o codigo de
    // producao sem cobertura — o teste exercitaria de novo uma copia.
    expect(auth, "a regra nao pode voltar para dentro do contexto")
      .not.toContain("function permissoesDoPapel(");
  });

  // `/admin` e o destino do login de TODO staff (`AdminLogin`) e era o destino do
  // redirect de negacao de permissao. Com `view_dashboard` desmarcado, a negacao
  // mandava para uma rota que negava de novo: sem laco, mas com a area de
  // conteudo em branco para sempre, sem mensagem, em todo login.
  it("negar permissao EXPLICA, em vez de redirecionar", () => {
    const pr = readFileSync("src/components/ProtectedRoute.tsx", "utf8");
    const bloco = pr.slice(pr.indexOf("if (requiredPermission"));
    expect(bloco, "redirecionar leva a tela branca quando o destino tambem exige permissao")
      .not.toContain('<Navigate to="/admin" replace />');
    expect(bloco).toContain("You do not have access to this screen.");
  });

  // A tela que GRAVA estoque em massa, sem guarda propria, e com a RLS liberando
  // `UPDATE produtos` para warehouse de proposito (20260619003000).
  it("Inventory Adjustment exige a mesma chave do menu", () => {
    for (const rota of ['path="/admin/estoque"', 'path="/admin/estoque/adjustment"']) {
      const i = app.indexOf(`<Route ${rota} `);
      expect(i, `rota sumiu: ${rota}`).toBeGreaterThan(-1);
      const linha = app.slice(i, app.indexOf("\n", i));
      expect(linha, `${rota} aceita qualquer staff`).toContain('<SP perm="view_products">');
    }
  });

  // Antes so 3 rotas exigiam permissao e o resto do admin era `AW` (qualquer
  // staff): desmarcar "View Orders" de um warehouse tirava o item do menu e ele
  // entrava digitando /admin/orders.
  it("as rotas cujo menu ja e filtrado exigem a MESMA permissao", () => {
    for (const [rota, perm] of [
      ['path="/admin"', "view_dashboard"],
      ['path="/admin/orders"', "view_orders"],
      ['path="/admin/orders/:id"', "view_orders"],
      ['path="/admin/customers"', "view_customers"],
      ['path="/admin/customers/:id"', "view_customers"],
      ['path="/admin/products"', "view_products"],
      ['path="/admin/product-categories"', "view_products"],
      ['path="/admin/producao/entrada"', "view_products"],
      ['path="/admin/producao/status"', "view_products"],
      ['path="/admin/producao/dashboard"', "view_products"],
    ]) {
      const i = app.indexOf(`<Route ${rota} `);
      expect(i, `rota sumiu: ${rota}`).toBeGreaterThan(-1);
      const linha = app.slice(i, app.indexOf("\n", i));
      expect(linha, `${rota} voltou a aceitar qualquer staff`).toContain(`<SP perm="${perm}">`);
    }
  });

  it("as chaves usadas nas rotas existem em DEFAULT_PERMISSIONS", () => {
    // Um `perm` com nome errado nao quebra o build — vira `undefined !== true` e
    // tranca todo mundo em silencio.
    const usadas = [...app.matchAll(/<SP perm="([^"]+)"/g)].map((m) => m[1]);
    expect(usadas.length).toBeGreaterThan(10);
    for (const k of new Set(usadas)) {
      expect(DEFAULT_PERMISSIONS.warehouse, `chave inexistente na rota: ${k}`).toHaveProperty(k);
    }
  });
});
