import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { brokeredPreviewStorage } from "@/integrations/supabase/previewAuthStorage";

// "NAO CONSEGUI VERIFICAR" != "SUA CONTA ESTA PENDENTE".
//
// Estas duas coisas eram a mesma tela ate 26/ago: qualquer falha ao ler
// `user_roles` (rede, RLS, token vencido) mandava o usuario para "Account
// Pending Approval" — uma afirmacao sobre o CADASTRO dele. Um administrador viu
// isso sobre a propria conta e teve motivo para achar que alguem tinha mexido
// nela. Erro de sistema mostra erro de sistema.
//
// COMPONENTE UNICO, e nao copias espalhadas. Renderizado por `ProtectedRoute`,
// `LoginLanding` e `Index`. A primeira versao do conserto so cobriu o
// `ProtectedRoute`, e a rota `/` — aba salva, sessao viva, favorito — e
// justamente por onde o dono entrou quando isso aconteceu.
//
// NAO E A LISTA COMPLETA de quem trata a falha: o `AdminLogin` tambem trata, sem
// renderizar esta tela, porque la o usuario ainda esta no formulario de login —
// ele deixa entrar e o `ProtectedRoute` decide depois. Antes ele DESLOGAVA o
// admin dizendo que a conta nao tinha acesso: pior que a tela de pendente, que
// so mentia.
//
// Se aparecer outro lugar que leia `user_roles`, ele precisa de tratamento
// tambem. A busca devolve varias ocorrencias: as de `CustomerEdit` e
// `UsersManagement` sao GESTAO de papel de TERCEIROS e nao entram. Importam as
// que leem o papel DO PROPRIO usuario para decidir o que ele pode ver — hoje sao
// TRES: `AuthContext.fetchRoleAndPermissions`, `AdminLogin`, e a checagem de
// impersonacao no `AuthContext` (essa ultima descarta o erro DE PROPOSITO, e tem
// comentario proprio explicando por que ali falhar e o lado seguro).
const ErroDeVerificacao = () => {
  const { signOut } = useAuth();

  // LIMPA O STORAGE A MAO, e nao confia no `signOut` — nem com `scope: "local"`.
  //
  // Conferido no `@supabase/auth-js` 2.108.2 instalado neste projeto, em
  // `GoTrueClient._signOut`: o `scope` escolhe apenas o query param, e a chamada
  // de rede acontece ANTES da limpeza local. Se ela falhar com algo que nao seja
  // 401/403/404 nem sessao ausente, a funcao retorna cedo e `_removeSession()`
  // NUNCA roda. Rede caida produz `AuthRetryableFetchError`, que nao esta nessa
  // lista — entao o token fica no navegador.
  //
  // Isso importa porque a rede caida e justamente a causa numero um de o usuario
  // estar nesta tela. Uma versao anterior deste botao usava `scope: "local"`
  // achando que ele pulava a rede, e o comentario afirmava isso; era falso, e o
  // botao morria exatamente no caso que o justifica.
  //
  // Limpa pelo STORAGE CONFIGURADO, nao pelo `localStorage` cru.
  //
  // Este projeto passa `storage: brokeredPreviewStorage()` ao criar o client
  // (`integrations/supabase/client.ts`). Numa superficie de preview do Lovable —
  // host de preview E dentro de iframe — o token de verdade vive no EDITOR, via
  // postMessage, e o `localStorage` e so espelho: a leitura pergunta ao broker
  // primeiro. Varrer o `localStorage` ali tira o espelho e deixa o token, e a
  // sessao volta no proximo carregamento. O `removeItem` do broker tira dos dois.
  //
  // Fora de iframe, `brokeredPreviewStorage()` devolve o proprio `localStorage`,
  // entao o mesmo caminho serve para producao.
  //
  // A chave e varrida por padrao (`sb-<ref>-auth-token`, e tambem
  // `-code-verifier` e `-user`, porque a regex nao esta ancorada no fim — o que
  // aqui e desejado).
  const sair = async () => {
    const store = brokeredPreviewStorage();
    const alvo = (chave: string) => /^sb-.*-auth-token/.test(chave);
    // Dois `try` separados: em modo privado o simples acesso a `localStorage`
    // pode lancar, e num `try` so o `sessionStorage` nunca seria varrido.
    try {
      for (const chave of Object.keys(localStorage).filter(alvo)) {
        await Promise.resolve(store.removeItem(chave)).catch(() => {});
      }
    } catch (e) {
      console.error("[erro-verificacao] limpeza do storage principal falhou", e);
    }
    try {
      for (const chave of Object.keys(sessionStorage).filter(alvo)) sessionStorage.removeItem(chave);
    } catch (e) {
      console.error("[erro-verificacao] limpeza do sessionStorage falhou", e);
    }

    // Tentativa de invalidar no servidor, com TETO DE TEMPO.
    //
    // Sem o teto isto era promessa vazia: `signOut` faz round-trips (lock,
    // leitura do storage — que no broker e postMessage) antes de disparar o POST,
    // e o `location.href` logo abaixo aborta a requisicao no meio. O refresh
    // token nunca era revogado, e o comentario anterior dizia que era.
    //
    // 1,5s: com rede, sobra; sem rede, nao prende o usuario numa tela de erro.
    // Se estourar, o token local ja foi embora e o remoto expira sozinho — aqui
    // o gatilho e "nao consegui ler meu papel", nao "fui comprometido".
    await Promise.race([
      supabase.auth.signOut().catch(() => undefined),
      new Promise((ok) => setTimeout(ok, 1500)),
    ]);
    try { void signOut(); } catch { /* o storage ja foi limpo */ }
    window.location.href = "/";
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-8 text-center">
        <h1 className="text-lg font-semibold">Could not verify your access</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This is a connection problem on our side — your account was not changed.
          Try again in a moment.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-6 w-full rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          Try again
        </button>
        {/* SAIDA. Sem este botao, um erro ESTAVEL (token podre, 500 do PostgREST)
            vira laco: erro -> "Try again" -> recarrega -> erro, sem saida a nao
            ser limpar o navegador. Token podre so se resolve saindo. */}
        <button
          type="button"
          onClick={() => { void sair(); }}
          className="mt-2 w-full rounded-md px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          Sign out
        </button>
      </div>
    </div>
  );
};

export default ErroDeVerificacao;
