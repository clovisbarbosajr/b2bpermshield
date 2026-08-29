import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

// TESTE QUE EXECUTA O COMPONENTE — e nao le o texto do arquivo.
//
// POR QUE `renderToStaticMarkup` e nao `@testing-library/react`: o pacote esta no
// `package.json`, mas o peer `@testing-library/dom` NAO esta instalado, entao
// qualquer `render()` estoura com "Cannot find module". Era por isso que os 38
// arquivos de teste do projeto conferiam codigo-FONTE com `toContain` — e foi por
// isso que o portao de permissao, a linha mais critica desta leva, ficou sem
// nenhuma cobertura de comportamento: inverter `!hasPermission` para
// `hasPermission` passava VERDE nos 375 testes. `react-dom/server` ja e
// dependencia e resolve, para um componente que so decide o que renderizar.
//
// `ErroDeVerificacao` e mockado porque arrasta o cliente Supabase.

const auth: any = {};
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/components/ErroDeVerificacao", () => ({ default: () => <i>ERRO_DE_VERIFICACAO</i> }));

const ProtectedRoute = (await import("./ProtectedRoute")).default;

const render = (props: Record<string, any>) =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={["/admin/estoque/adjustment"]}>
      <ProtectedRoute {...(props as any)}>
        <b>CONTEUDO_PROTEGIDO</b>
      </ProtectedRoute>
    </MemoryRouter>,
  );

/** Staff logado e aprovado; `permissions` decide o resto. */
const comoStaff = (permissions: Record<string, boolean>, role = "warehouse") => {
  Object.assign(auth, {
    user: { id: "u1" }, role, loading: false, isDemo: false,
    contaAprovada: true, falhaAoLerPapel: false,
    hasPermission: (k: string) => (role === "admin" ? true : permissions[k] === true),
  });
};

beforeEach(() => { for (const k of Object.keys(auth)) delete auth[k]; });

describe("ProtectedRoute: o portao de permissao", () => {
  it("SEM a permissao, o conteudo NAO renderiza", () => {
    comoStaff({ view_products: false });
    const html = render({ requiredRole: "staff", requiredPermission: "view_products" });
    expect(html, "a tela protegida vazou para quem nao tem a chave")
      .not.toContain("CONTEUDO_PROTEGIDO");
    expect(html, "nao chegou no portao — a negacao veio de outra guarda")
      .toContain("You do not have access");
  });

  it("SEM a permissao, o operador recebe uma EXPLICACAO", () => {
    // A versao anterior redirecionava para `/admin`, que tambem exige permissao:
    // o operador ficava com a area de conteudo em branco para sempre, em todo
    // login, sem uma palavra.
    comoStaff({ view_products: false });
    const html = render({ requiredRole: "staff", requiredPermission: "view_products" });
    expect(html).toContain("You do not have access to this screen.");
    // E nao pode ser um redirect — para NENHUMA rota. Um `Navigate` nao emite
    // markup, entao a ausencia da mensagem denuncia qualquer redirect novo,
    // inclusive para uma rota diferente de `/admin`.
    expect(html.replace(/<!--.*?-->/g, "").trim().length,
      "redirect silencioso: nao ha markup nenhum para o operador ler").toBeGreaterThan(0);
  });

  it("COM a permissao, o conteudo renderiza", () => {
    comoStaff({ view_products: true });
    const html = render({ requiredRole: "staff", requiredPermission: "view_products" });
    expect(html, "quem tem a chave foi barrado").toContain("CONTEUDO_PROTEGIDO");
    expect(html).not.toContain("You do not have access");
  });

  it("admin passa mesmo com o mapa vazio", () => {
    comoStaff({}, "admin");
    expect(render({ requiredRole: "staff", requiredPermission: "view_products" }))
      .toContain("CONTEUDO_PROTEGIDO");
  });

  it("SEM `requiredPermission`, o portao nem entra em cena", () => {
    // Se o `requiredPermission &&` for adulterado para uma condicao que nunca
    // vale, o portao se desliga para as 20 rotas de uma vez — e este par de
    // testes (com e sem a chave) e o que detecta isso.
    comoStaff({});
    expect(render({ requiredRole: "staff" })).toContain("CONTEUDO_PROTEGIDO");
  });

  it("a chave certa e a chave PEDIDA, nao qualquer uma", () => {
    // Ter `view_orders` nao pode abrir uma rota que pede `view_products`.
    comoStaff({ view_orders: true, view_products: false });
    const html = render({ requiredRole: "staff", requiredPermission: "view_products" });
    expect(html).not.toContain("CONTEUDO_PROTEGIDO");
    // E a assercao POSITIVA prova que a negacao veio do PORTAO, e nao de o
    // componente ter desviado antes (sem `user`, por exemplo, o markup fica
    // vazio e um `not.toContain` sozinho passaria sem exercitar nada).
    expect(html, "nao chegou no portao de permissao").toContain("You do not have access");
  });
});

describe("ProtectedRoute: as guardas que ja existiam continuam valendo", () => {
  it("carregando: mostra o spinner e nao decide nada", () => {
    Object.assign(auth, { user: null, role: null, loading: true, isDemo: false,
      contaAprovada: true, falhaAoLerPapel: false, hasPermission: () => false });
    const html = render({ requiredRole: "staff", requiredPermission: "view_products" });
    // A ASSERCAO POSITIVA E O QUE IMPORTA: so afirmar as duas ausencias deixava
    // apagar a guarda de `loading` INTEIRA sem reprovar nada — o markup vazio do
    // `<Navigate to="/">` (que `!user` produz) satisfaz qualquer `not.toContain`.
    // Sem a guarda, todo staff e jogado para `/` a cada refresh, antes do auth
    // resolver.
    expect(html, "sumiu a guarda de carregamento").toContain("animate-spin");
    expect(html, "decidir antes de carregar barraria quem tem acesso")
      .not.toContain("You do not have access");
    expect(html).not.toContain("CONTEUDO_PROTEGIDO");
  });

  // D3: as tres clausulas `!isDemo` nao tinham cobertura nenhuma — remover
  // qualquer uma delas passava nos 384 testes. O modo demo existe para mostrar o
  // sistema sem ficha de cliente no banco; sem o `!isDemo` ele bate nas guardas
  // de aprovacao e nao ve nada.
  // Cada uma das tres exige uma assercao POSITIVA (o conteudo renderiza), porque
  // sem `!isDemo` a guarda dispara um `<Navigate>` — que nao emite markup, e
  // markup vazio satisfaz qualquer `not.toContain`. Foi assim que a primeira
  // versao deste teste deixou a mutacao de `!role` passar verde.
  it("demo sem papel: `!isDemo` isenta a guarda de `!role`", () => {
    Object.assign(auth, { user: { id: "demo" }, role: null, loading: false, isDemo: true,
      contaAprovada: true, falhaAoLerPapel: false, hasPermission: () => true });
    expect(render({}), "`!isDemo` sumiu da guarda de `!role`: demo vai para /pending-approval")
      .toContain("CONTEUDO_PROTEGIDO");
  });

  it("demo com falha de leitura de papel: `!isDemo` isenta", () => {
    Object.assign(auth, { user: { id: "demo" }, role: null, loading: false, isDemo: true,
      contaAprovada: true, falhaAoLerPapel: true, hasPermission: () => true });
    const html = render({});
    expect(html, "`!isDemo` sumiu da guarda de `falhaAoLerPapel`").toContain("CONTEUDO_PROTEGIDO");
    expect(html).not.toContain("ERRO_DE_VERIFICACAO");
  });

  it("demo de cliente NAO aprovado: `!isDemo` isenta a guarda de aprovacao", () => {
    Object.assign(auth, { user: { id: "demo" }, role: "cliente", loading: false, isDemo: true,
      contaAprovada: false, falhaAoLerPapel: false, hasPermission: () => true });
    expect(render({ requiredRole: "cliente" }),
      "`!isDemo` sumiu da guarda de `contaAprovada`: a demo do portal para de abrir")
      .toContain("CONTEUDO_PROTEGIDO");
  });

  // CONTROLE das tres acima: sem `isDemo`, cada guarda TEM que barrar.
  it("sem demo, as mesmas situacoes barram", () => {
    Object.assign(auth, { user: { id: "u1" }, role: null, loading: false, isDemo: false,
      contaAprovada: true, falhaAoLerPapel: true, hasPermission: () => true });
    expect(render({})).toContain("ERRO_DE_VERIFICACAO");

    Object.assign(auth, { user: { id: "u1" }, role: "cliente", loading: false, isDemo: false,
      contaAprovada: false, falhaAoLerPapel: false, hasPermission: () => true });
    expect(render({ requiredRole: "cliente" })).not.toContain("CONTEUDO_PROTEGIDO");
  });

  it("demo com papel de staff e SEM a chave continua barrado", () => {
    // O `isDemo` isenta das guardas de FICHA, nao do portao de permissao.
    Object.assign(auth, { user: { id: "demo" }, role: "warehouse", loading: false, isDemo: true,
      contaAprovada: true, falhaAoLerPapel: false, hasPermission: () => false });
    const html = render({ requiredRole: "staff", requiredPermission: "view_products" });
    expect(html).toContain("You do not have access to this screen.");
    expect(html).not.toContain("CONTEUDO_PROTEGIDO");
  });

  it("falha ao LER o papel nao vira 'sem permissao'", () => {
    // Sao coisas diferentes: uma e o banco fora do ar, a outra e decisao do admin.
    Object.assign(auth, { user: { id: "u1" }, role: null, loading: false, isDemo: false,
      contaAprovada: true, falhaAoLerPapel: true, hasPermission: () => false });
    const html = render({ requiredRole: "staff", requiredPermission: "view_products" });
    expect(html).toContain("ERRO_DE_VERIFICACAO");
    expect(html).not.toContain("You do not have access");
  });

  // A guarda IRMA, tres linhas acima das de `isDemo`: podia ser apagada inteira
  // com 391 testes verdes. Sem ela, visitante deslogado passa a cair nas guardas
  // de ficha (`/pending-approval`) em vez de na home — e um `Navigate` nao emite
  // markup, entao so assercao POSITIVA detecta a troca.
  it("sem usuario, vai para a home — e nao para as guardas de ficha", () => {
    Object.assign(auth, { user: null, role: null, loading: false, isDemo: false,
      contaAprovada: true, falhaAoLerPapel: true, hasPermission: () => true });
    // `falhaAoLerPapel: true` e o detector: se a guarda de `!user` sumir ou for
    // movida para depois, este caso passa a renderizar o `ErroDeVerificacao`.
    const html = render({});
    expect(html, "a guarda de `!user` sumiu ou desceu na ordem")
      .not.toContain("ERRO_DE_VERIFICACAO");
    expect(html).not.toContain("CONTEUDO_PROTEGIDO");
  });

  it("papel que nao e staff nao chega no portao de permissao", () => {
    Object.assign(auth, { user: { id: "u1" }, role: "cliente", loading: false, isDemo: false,
      contaAprovada: true, falhaAoLerPapel: false, hasPermission: () => true });
    const html = render({ requiredRole: "staff", requiredPermission: "view_products" });
    expect(html).not.toContain("CONTEUDO_PROTEGIDO");
  });
});
