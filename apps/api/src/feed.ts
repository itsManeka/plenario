import { sql } from "@plenario/core/db";
import type { FeedItem, FeedItemTipo, Pagina, VotoTipo } from "@plenario/core/api";
import {
  codificarCursor,
  comOPartido,
  decodificarCursor,
  erro400,
  FMT_ISO,
  parlamentarResumo,
  proposicaoResumo,
  urlCotaCamara,
  urlOficialParlamentar,
  votacaoResumo,
  type LinhaParlamentarResumo,
  type LinhaProposicaoResumo,
  type LinhaVotacaoResumo,
} from "./util";

export const TAMANHO_PAGINA = 30;
const TIPOS: readonly FeedItemTipo[] = ["voto", "proposicao", "despesa_mensal"];

export function validarTipos(v: string | undefined): FeedItemTipo[] | null {
  if (v === undefined || v.trim() === "") return null;
  const tipos = [...new Set(v.split(",").map((s) => s.trim()).filter(Boolean))];
  for (const t of tipos) {
    if (!(TIPOS as readonly string[]).includes(t)) throw erro400(`tipo inválido: ${t} (use ${TIPOS.join(", ")})`);
  }
  // todos os tipos = sem filtro (o plano sem filtro de tipo é o mais barato)
  return tipos.length === TIPOS.length ? null : (tipos as FeedItemTipo[]);
}

// Cursor do feed: "<ocorrido_em em microssegundos desde epoch>.<evento.id>". Microssegundo e não
// milissegundo porque timestamptz guarda µs: truncar pra ms faria pular/repetir itens.
const RE_CURSOR_FEED = /^(-?\d{1,17})\.(\d{1,18})$/;

interface LinhaEvento {
  id: string;
  parlamentar_id: string;
  tipo: FeedItemTipo;
  ocorrido_iso: string;
  ref_id: string;
  cur_us: string;
}

export interface FiltroFeed {
  parlamentares: string[] | null; // null = feed geral
  tipos: FeedItemTipo[] | null;
  cursor: string | undefined;
}

export async function paginaFeed(f: FiltroFeed): Promise<Pagina<FeedItem>> {
  const c = decodificarCursor(f.cursor, RE_CURSOR_FEED);
  const limite = TAMANHO_PAGINA + 1; // um a mais pra saber se há próxima página

  const condTipo = f.tipos ? sql`and e.tipo = any(${f.tipos}::evento_tipo[])` : sql``;
  // Comparação de linha (ocorrido_em, id) < (...) vira condição de índice nos dois índices de
  // evento, então a página N custa o mesmo que a primeira.
  const condCursor = c
    ? sql`and (e.ocorrido_em, e.id) < (timestamptz 'epoch' + ${c[1]!}::bigint * interval '1 microsecond', ${c[2]!}::bigint)`
    : sql``;
  const colunas = sql`e.id::text as id, e.parlamentar_id, e.tipo, e.ocorrido_em, e.ref_id,
    to_char(e.ocorrido_em at time zone 'UTC', ${FMT_ISO}) as ocorrido_iso,
    (extract(epoch from e.ocorrido_em) * 1000000)::bigint::text as cur_us`;

  const ORDEM = sql`order by e.ocorrido_em desc, e.id desc`;

  let eventos: LinhaEvento[];
  if (f.parlamentares === null) {
    eventos = await sql<LinhaEvento[]>`
      select ${colunas} from evento e
      where true ${condTipo} ${condCursor}
      ${ORDEM}
      limit ${limite}`;
  } else {
    if (f.parlamentares.length === 0) return { itens: [], proximo: null };
    // Um top-N por parlamentar (evento_feed_idx) e merge: custo ~ ids × 31 linhas, independente
    // de quantos eventos cada um tem. Um "parlamentar_id = any(...)" direto tenderia a ler tudo
    // de cada um e ordenar, ou varrer o índice global filtrando.
    eventos = await sql<LinhaEvento[]>`
      select x.* from unnest(${f.parlamentares}::text[]) as p(id)
      cross join lateral (
        select ${colunas} from evento e
        where e.parlamentar_id = p.id ${condTipo} ${condCursor}
        ${ORDEM}
        limit ${limite}
      ) x
      order by x.ocorrido_em desc, x.id::bigint desc
      limit ${limite}`;
  }

  const temMais = eventos.length > TAMANHO_PAGINA;
  const pagina = temMais ? eventos.slice(0, TAMANHO_PAGINA) : eventos;
  const ultimo = pagina[pagina.length - 1];
  const proximo = temMais && ultimo ? codificarCursor(`${ultimo.cur_us}.${ultimo.id}`) : null;
  return { itens: await montarItens(pagina), proximo };
}

interface LinhaVotoFeed {
  votacao_id: string;
  parlamentar_id: string;
  voto: VotoTipo;
  partido_na_hora: string | null;
  sim: number | null;
  nao: number | null;
}

interface LinhaAutoria {
  proposicao_id: string;
  parlamentar_id: string;
  ordem: number | null;
  n_autores: number;
}

interface LinhaDespesaCat {
  parlamentar_id: string;
  ano: number;
  mes: number;
  categoria: string;
  valor: number;
}

const chave = (...p: (string | number)[]) => p.join("|");
const RE_MES = /^(\d{4})-(\d{1,2})$/;

// Hidrata uma página de eventos com um número fixo de consultas (no máx. 6, em paralelo),
// independente do tamanho da página.
async function montarItens(eventos: LinhaEvento[]): Promise<FeedItem[]> {
  if (eventos.length === 0) return [];

  const parlIds = [...new Set(eventos.map((e) => e.parlamentar_id))];
  const votos = eventos.filter((e) => e.tipo === "voto");
  const props = eventos.filter((e) => e.tipo === "proposicao");
  const desps = eventos
    .filter((e) => e.tipo === "despesa_mensal")
    .map((e) => ({ e, m: e.ref_id.match(RE_MES) }))
    .filter((x): x is { e: LinhaEvento; m: RegExpMatchArray } => x.m !== null);

  const votacaoIds = [...new Set(votos.map((e) => e.ref_id))];
  const propIds = [...new Set(props.map((e) => e.ref_id))];

  const [parls, votacoes, votosLinhas, proposicoes, autorias, despesas] = await Promise.all([
    sql<(LinhaParlamentarResumo & { id_externo: string })[]>`
      select id, casa, id_externo, nome, partido, uf, foto_url, em_exercicio
      from parlamentar where id = any(${parlIds}::text[])`,
    votacaoIds.length
      ? sql<LinhaVotacaoResumo[]>`${selectVotacaoResumo()} where v.id = any(${votacaoIds}::text[])`
      : [],
    votos.length
      ? sql<LinhaVotoFeed[]>`
          with partidos as (
            -- votacao_id = any(array) usa o prefixo da PK de voto; um semi-join com a lista
            -- dos próprios votos levava o planner a varrer a tabela voto inteira (~200 ms)
            select v.votacao_id, v.partido_na_hora,
                   count(*) filter (where v.voto = 'sim')::int as sim,
                   count(*) filter (where v.voto = 'nao')::int as nao
            from voto v
            where v.votacao_id = any(${votacaoIds}::text[]) and v.partido_na_hora is not null
            group by 1, 2
          )
          select m.votacao_id, m.parlamentar_id, m.voto, m.partido_na_hora, p.sim, p.nao
          from unnest(${votos.map((e) => e.ref_id)}::text[], ${votos.map((e) => e.parlamentar_id)}::text[])
            as k(votacao_id, parlamentar_id)
          join voto m on m.votacao_id = k.votacao_id and m.parlamentar_id = k.parlamentar_id
          left join partidos p on p.votacao_id = m.votacao_id and p.partido_na_hora = m.partido_na_hora`
      : [],
    propIds.length
      ? sql<LinhaProposicaoResumo[]>`
          select id, casa, sigla_tipo, numero, ano, ementa, url from proposicao where id = any(${propIds}::text[])`
      : [],
    propIds.length
      ? sql<LinhaAutoria[]>`
          select a.proposicao_id, a.parlamentar_id, a.ordem,
                 (select count(*)::int from proposicao_autor b where b.proposicao_id = a.proposicao_id) as n_autores
          from proposicao_autor a
          join unnest(${props.map((e) => e.ref_id)}::text[], ${props.map((e) => e.parlamentar_id)}::text[])
            as k(proposicao_id, parlamentar_id) using (proposicao_id, parlamentar_id)`
      : [],
    desps.length
      ? sql<LinhaDespesaCat[]>`
          select d.parlamentar_id, d.ano, d.mes, d.categoria, round(sum(d.valor), 2)::float8 as valor
          from despesa d
          join unnest(${desps.map((x) => x.e.parlamentar_id)}::text[],
                      ${desps.map((x) => Number(x.m[1]))}::int[],
                      ${desps.map((x) => Number(x.m[2]))}::int[]) as k(parlamentar_id, ano, mes)
            using (parlamentar_id, ano, mes)
          group by 1, 2, 3, 4`
      : [],
  ]);

  const parlPorId = new Map(parls.map((p) => [p.id, parlamentarResumo(p)]));
  const perfilPorId = new Map(parls.map((p) => [p.id, urlOficialParlamentar(p.casa, p.id_externo)]));
  const externoPorId = new Map(parls.map((p) => [p.id, p.id_externo]));
  const votacaoPorId = new Map(votacoes.map((v) => [v.id, votacaoResumo(v)]));
  const votoPor = new Map(votosLinhas.map((v) => [chave(v.votacao_id, v.parlamentar_id), v]));
  const propPorId = new Map(proposicoes.map((p) => [p.id, proposicaoResumo(p)]));
  const autoriaPor = new Map(autorias.map((a) => [chave(a.proposicao_id, a.parlamentar_id), a]));
  const despPor = new Map<string, { categoria: string; valor: number }[]>();
  for (const d of despesas) {
    const k = chave(d.parlamentar_id, d.ano, d.mes);
    const l = despPor.get(k);
    if (l) l.push({ categoria: d.categoria, valor: d.valor });
    else despPor.set(k, [{ categoria: d.categoria, valor: d.valor }]);
  }

  // Evento cuja origem sumiu (ref quebrada) é omitido em vez de virar card incompleto; o cursor
  // continua andando pelo evento cru, então nada se repete.
  const itens: FeedItem[] = [];
  for (const e of eventos) {
    const parlamentar = parlPorId.get(e.parlamentar_id);
    const perfil = perfilPorId.get(e.parlamentar_id);
    if (!parlamentar || !perfil) continue;
    const base = { id: e.id, ocorridoEm: e.ocorrido_iso, parlamentar };

    if (e.tipo === "voto") {
      const votacao = votacaoPorId.get(e.ref_id);
      const v = votoPor.get(chave(e.ref_id, e.parlamentar_id));
      if (!votacao || !v) continue;
      itens.push({
        ...base,
        urlFonte: votacao.urlOficial ?? votacao.proposicao?.url ?? perfil,
        tipo: "voto",
        voto: v.voto,
        votacao,
        comOPartido: comOPartido(v.voto, v.partido_na_hora, v.sim, v.nao),
      });
    } else if (e.tipo === "proposicao") {
      const proposicao = propPorId.get(e.ref_id);
      if (!proposicao) continue;
      const a = autoriaPor.get(chave(e.ref_id, e.parlamentar_id));
      // primeiro signatário = autor; sem ordem na fonte, autor único também é autor
      const autor = a ? a.ordem === 1 || (a.ordem === null && a.n_autores === 1) : false;
      itens.push({ ...base, urlFonte: proposicao.url ?? perfil, tipo: "proposicao", papel: autor ? "autor" : "coautor", proposicao });
    } else {
      const m = e.ref_id.match(RE_MES);
      if (!m) continue;
      const ano = Number(m[1]);
      const mes = Number(m[2]);
      const cats = despPor.get(chave(e.parlamentar_id, ano, mes)) ?? [];
      cats.sort((x, y) => y.valor - x.valor || x.categoria.localeCompare(y.categoria));
      const total = Math.round(cats.reduce((s, c) => s + c.valor, 0) * 100) / 100;
      const externo = externoPorId.get(e.parlamentar_id);
      // Senado não tem despesa no v1; se vier, o perfil é a página mais específica que há
      const urlFonte = parlamentar.casa === "camara" && externo ? urlCotaCamara(externo, ano, mes) : perfil;
      itens.push({ ...base, urlFonte, tipo: "despesa_mensal", ano, mes, total, porCategoria: cats.slice(0, 5) });
    }
  }
  return itens;
}

export function selectVotacaoResumo() {
  return sql`
    select v.id, v.casa, v.id_externo, to_char(v.data_hora at time zone 'UTC', ${FMT_ISO}) as data_hora,
           v.data_hora_aproximada, v.orgao, v.descricao, v.aprovada, v.nominal, v.secreta, v.url,
           v.placar_sim, v.placar_nao, v.placar_outros,
           p.id as p_id, p.casa as p_casa, p.sigla_tipo as p_sigla_tipo, p.numero as p_numero,
           p.ano as p_ano, p.ementa as p_ementa, p.url as p_url
    from votacao v left join proposicao p on p.id = v.proposicao_id`;
}
