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
export const nadaFoiEscrito = (data: unknown[] | null | undefined, error: unknown) =>
  !error && (data?.length ?? 0) === 0;
