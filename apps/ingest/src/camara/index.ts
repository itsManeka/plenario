// Ingest da Câmara dos Deputados, legislatura 57 (desde 2023-02-01).
//
// Carga pesada pelos arquivos em lote (dadosabertos.camara.leg.br/arquivos e o CEAP em
// camara.leg.br/cotas), que são regerados uma vez por dia; a API só entra para a lista de
// deputados e para as votações mais novas que o arquivo do dia.
//
// Cada fonte tem seu cursor em `ingest_cursor`:
//   camara:deputados    sempre recarrega (são ~650 linhas)
//   camara:proposicoes  retoma do 1º de janeiro do ano da última proposição: coautoria entra
//                       depois da apresentação, então o ano corrente é sempre reprocessado
//   camara:votacoes     retoma 7 dias antes da última votação gravada
//   camara:despesas     retoma 3 meses antes da última carga: o deputado tem 90 dias pra
//                       apresentar a nota, então meses recentes ainda mudam
//   camara:exercicio    histórico só de quem é novo ou mudou de situação; todos a cada 7 dias
// Sem --desde, arquivo cujo etag não mudou desde a última carga completa é pulado.

import type { OpcoesIngest } from "../index";
import {
  INICIO_LEGISLATURA,
  type EstadoCursor,
  type Periodo,
  fmt,
  gravarCursor,
  hojeBrasilia,
  idsParlamentares,
  lerCursor,
  log,
  somarDias,
} from "./comum";
import { ingerirDeputados } from "./deputados";
import { ingerirDespesas } from "./despesas";
import { ingerirExercicio } from "./exercicio";
import { ingerirProposicoes } from "./proposicoes";
import { ingerirVotacoes } from "./votacoes";
import { sql } from "@plenario/core/db";

const DIA = /^\d{4}-\d{2}-\d{2}$/;

function periodo(
  opcoes: OpcoesIngest,
  cursor: EstadoCursor | null,
  retomada: (ultima: string) => string,
): Periodo {
  const ate = opcoes.ate ?? hojeBrasilia();
  let desde: string;
  let incremental = false;
  if (opcoes.desde) desde = opcoes.desde;
  else if (cursor?.ultimaData) {
    desde = retomada(cursor.ultimaData);
    incremental = true;
  } else desde = INICIO_LEGISLATURA;
  // escopo do v1 é a legislatura 57
  if (desde < INICIO_LEGISLATURA) desde = INICIO_LEGISLATURA;
  return { desde, ate, incremental };
}

export async function run(opcoes: OpcoesIngest): Promise<void> {
  for (const [nome, v] of Object.entries(opcoes)) {
    if (v !== undefined && !DIA.test(v)) throw new Error(`--${nome} precisa ser AAAA-MM-DD (veio ${v})`);
  }
  const inicio = Date.now();
  log(`início${opcoes.desde ? ` (--desde ${opcoes.desde})` : ""}${opcoes.ate ? ` (--ate ${opcoes.ate})` : ""}`);

  const deputados = await ingerirDeputados();
  const parlamentares = await idsParlamentares();

  {
    const fonte = "camara:proposicoes";
    const cursor = await lerCursor(fonte);
    const p = periodo(opcoes, cursor, (u) => `${u.slice(0, 4)}-01-01`);
    log(`proposições: ${p.desde} a ${p.ate}${p.incremental ? " (incremental)" : ""}`);
    const r = await ingerirProposicoes(p, parlamentares, cursor);
    await gravarCursor(fonte, { ultimaData: r.ultimaData, etags: r.etags });
  }
  {
    const fonte = "camara:votacoes";
    const cursor = await lerCursor(fonte);
    const p = periodo(opcoes, cursor, (u) => somarDias(u, -7));
    log(`votações: ${p.desde} a ${p.ate}${p.incremental ? " (incremental)" : ""}`);
    const r = await ingerirVotacoes(p, parlamentares, cursor);
    await gravarCursor(fonte, { ultimaData: r.ultimaData, ultimaDataArquivo: r.ultimaDataArquivo, etags: r.etags });
  }
  {
    const fonte = "camara:despesas";
    const cursor = await lerCursor(fonte);
    const p = periodo(opcoes, cursor, (u) => `${somarDias(u, -92).slice(0, 7)}-01`);
    log(`despesas: ${p.desde} a ${p.ate}${p.incremental ? " (incremental)" : ""}`);
    const r = await ingerirDespesas(p, parlamentares, cursor);
    await gravarCursor(fonte, { ultimaData: r.ultimaData, etags: r.etags });
  }

  // depois das votações: o fim do período usa os votos gravados como evidência
  await ingerirExercicio(deputados.ids, deputados.mudaram);

  const contagem = await sql<{ tipo: string; n: number }[]>`
    select tipo::text as tipo, count(*)::int as n from evento
    where parlamentar_id like 'camara:%' group by tipo order by tipo`;
  const feed = contagem.map((l) => `${l.tipo}=${fmt(l.n)}`).join(", ") || "vazio";
  log(`fim em ${((Date.now() - inicio) / 60_000).toFixed(1)} min. Feed da Câmara: ${feed}`);
}
