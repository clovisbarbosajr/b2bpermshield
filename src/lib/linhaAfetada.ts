// RECUSA SILENCIOSA — o caso que `gravacaoRecusadaComCerteza` NAO cobre.
//
// Aquele helper responde "houve erro, e o commit aconteceu?". Este responde a
// pergunta anterior, que nao tem erro nenhum: **o UPDATE/DELETE encontrou linha?**
//
// Sob RLS, `USING` de policy nao levanta erro em UPDATE e DELETE — ele FILTRA. A
// linha que o `USING` esconde simplesmente nao casa, o PostgREST devolve
// `error: null` e a tela comemora uma escrita que nunca existiu. O mesmo desfecho
// vem de concorrencia banal: outro admin apagou a linha enquanto esta tela estava
// aberta.
//
// A diferenca com INSERT importa e e por isso que este helper NAO deve ser
// espalhado por toda escrita: INSERT (e o `ON CONFLICT DO UPDATE` do upsert) bate
// no `WITH CHECK`, que LEVANTA 42501. Ali `error` ja conta a verdade, e chamar isto
// so acrescentaria ruido.
//
// Exige `.select(...)` na chamada — sem ele o PostgREST devolve `data: null` e nao
// da para distinguir "nao gravou" de "nao pedi para ver".
//
// Aceita as DUAS formas que o PostgREST devolve: array (`.select()`) e objeto ou
// `null` (`.select().maybeSingle()`). A versao anterior so tratava array, e um
// objeto entrava por `data?.length ?? 0` — `length` de objeto e `undefined`, virava
// 0, e a funcao afirmava "nada foi escrito" sobre uma linha que ESTAVA ali. Falha
// aberta ao contrario: em vez de comemorar escrita que nao houve, recusaria escrita
// que houve. Por isso a checagem e explicita por forma, nao por `length`.
export const nadaFoiEscrito = (
  data: unknown[] | Record<string, unknown> | null | undefined,
  error: unknown,
) => !error && (data == null || (Array.isArray(data) && data.length === 0));
