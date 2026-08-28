// GRAVACAO QUE COM CERTEZA NAO ACONTECEU — e so isso.
//
// A pergunta que importa depois de um erro de escrita nao e "deu erro?", e sim "o
// commit aconteceu?". Errar isso custa produto duplicado no catalogo (se assumir
// que nao gravou) ou acusar de conflito um colega que nao existe (se assumir que
// gravou).
//
// A REGRA E O `code`, NAO O STATUS. `code` preenchido significa que o PostgREST
// respondeu com corpo JSON estruturado — ou seja, a requisicao chegou nele e ele
// sabe o desfecho: a transacao abortou e nada foi escrito. Vale para
// `22003` (numero fora de faixa), `23505` (duplicata), `PGRST204` (coluna
// inexistente), `PGRST301` (sem permissao), e tambem para os de concorrencia
// (`57014` timeout, `40001` serializacao, `40P01` deadlock), que chegam como 5xx.
//
// TESTAR A FAIXA DO STATUS ESTAVA ERRADO nas duas direcoes, e as duas foram
// medidas em `node_modules/@supabase/postgrest-js/dist/index.mjs`:
//   * `status: 0` — falha de fetch, `code: ""`. A resposta nunca voltou;
//   * 5xx de gateway (502, 504, 520/522/524 do Cloudflare) — corpo HTML, o
//     `JSON.parse` falha e sobra `{ message: body }` SEM `code`. A escrita pode ter
//     ido: a propria lib lista 520 e 503 como retentaveis e ainda assim se recusa a
//     repetir POST/PATCH;
//   * `res.ok` com corpo nao-JSON — `error` com status 200/201 e sem `code`. Aqui a
//     gravacao provavelmente ATE aconteceu.
//
// Duas versoes anteriores erraram aqui: a primeira testava `status === 0` (deixava
// o 5xx de gateway passar por definitivo, e o proximo save criava produto
// duplicado); a segunda exigia 4xx, e mandava erro de concorrencia — que aborta a
// transacao com certeza — para o balde do "incerto", travando a tela a toa.
export const gravacaoRecusadaComCerteza = (_status: number, error: any) =>
  !!error?.code;
