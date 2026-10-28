import type { Casa, Placar, ParlamentarResumo, ProposicaoResumo, VotacaoResumo, VotoTipo } from "@plenario/core/api";

// Erro com status HTTP; o onError do app converte em { erro } (ErroApi).
export class ErroHttp extends Error {
  constructor(
    readonly status: 400 | 404,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

export const erro400 = (msg: string) => new ErroHttp(400, msg);
export const erro404 = (msg: string) => new ErroHttp(404, msg);

const RE_ID = /^(camara|senado):[A-Za-z0-9._-]{1,64}$/;

export function validarId(id: string, oQue: string): string {
  if (!RE_ID.test(id)) throw erro400(`${oQue} inválido: esperado "<casa>:<id>"`);
  return id;
}

export function validarCasa(v: string | undefined): Casa | undefined {
  if (v === undefined || v === "") return undefined;
  if (v !== "camara" && v !== "senado") throw erro400('casa deve ser "camara" ou "senado"');
  return v;
}

export function validarLimite(v: string | undefined, padrao: number, max: number): number {
  if (v === undefined || v === "") return padrao;
  if (!/^\d{1,4}$/.test(v)) throw erro400("limite deve ser inteiro positivo");
  const n = Number(v);
  if (n < 1 || n > max) throw erro400(`limite deve estar entre 1 e ${max}`);
  return n;
}

// Cursor opaco: base64url de um texto curto. O conteúdo é detalhe de implementação de cada rota.
export function codificarCursor(texto: string): string {
  return Buffer.from(texto, "utf8").toString("base64url");
}

export function decodificarCursor(cursor: string | undefined, formato: RegExp): RegExpMatchArray | null {
  if (cursor === undefined || cursor === "") return null;
  if (cursor.length > 600 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw erro400("cursor inválido");
  const m = Buffer.from(cursor, "base64url").toString("utf8").match(formato);
  if (!m) throw erro400("cursor inválido");
  return m;
}

// O `sql` compartilhado passa pelo driver do drizzle, que desliga o parser de datas do postgres.js
// (timestamptz chega como texto no fuso da sessão). Por isso as datas saem formatadas do próprio
// SQL, já em UTC: to_char(col at time zone 'UTC', ${FMT_ISO}).
export const FMT_ISO = 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"';

// ---- mapeamento de linhas do banco para os tipos do contrato ----

export interface LinhaParlamentarResumo {
  id: string;
  casa: Casa;
  nome: string;
  partido: string | null;
  uf: string | null;
  foto_url: string | null;
  em_exercicio: boolean;
}

export const COLUNAS_PARLAMENTAR_RESUMO = ["id", "casa", "nome", "partido", "uf", "foto_url", "em_exercicio"] as const;

export function parlamentarResumo(r: LinhaParlamentarResumo): ParlamentarResumo {
  return {
    id: r.id,
    casa: r.casa,
    nome: r.nome,
    partido: r.partido,
    uf: r.uf,
    fotoUrl: r.foto_url,
    emExercicio: r.em_exercicio,
  };
}

export function rotulo(siglaTipo: string, numero: number | null, ano: number | null): string {
  let s = siglaTipo;
  if (numero !== null) s += ` ${numero}`;
  if (ano !== null) s += numero !== null ? `/${ano}` : ` ${ano}`;
  return s;
}

export interface LinhaProposicaoResumo {
  id: string;
  casa: Casa;
  sigla_tipo: string;
  numero: number | null;
  ano: number | null;
  ementa: string | null;
  url: string | null;
}

export function proposicaoResumo(r: LinhaProposicaoResumo): ProposicaoResumo {
  return {
    id: r.id,
    casa: r.casa,
    siglaTipo: r.sigla_tipo,
    numero: r.numero,
    ano: r.ano,
    rotulo: rotulo(r.sigla_tipo, r.numero, r.ano),
    ementa: r.ementa,
    url: r.url,
  };
}

// Linha de votação com a proposição em left join (colunas p_*).
export interface LinhaVotacaoResumo {
  id: string;
  casa: Casa;
  id_externo: string;
  data_hora: string;
  data_hora_aproximada: boolean;
  orgao: string | null;
  descricao: string | null;
  aprovada: boolean | null;
  nominal: boolean;
  secreta: boolean;
  url: string | null;
  placar_sim: number | null;
  placar_nao: number | null;
  placar_outros: number | null;
  p_id: string | null;
  p_casa: Casa | null;
  p_sigla_tipo: string | null;
  p_numero: number | null;
  p_ano: number | null;
  p_ementa: string | null;
  p_url: string | null;
}

export function votacaoResumo(r: LinhaVotacaoResumo): VotacaoResumo {
  const placar: Placar | null =
    r.placar_sim === null && r.placar_nao === null && r.placar_outros === null
      ? null
      : { sim: r.placar_sim ?? 0, nao: r.placar_nao ?? 0, outros: r.placar_outros ?? 0 };
  const proposicao =
    r.p_id !== null && r.p_casa !== null && r.p_sigla_tipo !== null
      ? proposicaoResumo({
          id: r.p_id,
          casa: r.p_casa,
          sigla_tipo: r.p_sigla_tipo,
          numero: r.p_numero,
          ano: r.p_ano,
          ementa: r.p_ementa,
          url: r.p_url,
        })
      : null;
  return {
    id: r.id,
    casa: r.casa,
    dataHora: r.data_hora,
    dataHoraAproximada: r.data_hora_aproximada,
    orgao: r.orgao,
    descricao: r.descricao,
    aprovada: r.aprovada,
    nominal: r.nominal,
    secreta: r.secreta,
    urlOficial: r.url,
    placar,
    proposicao,
  };
}

// "Votou com o partido": compara com a maioria simples entre sim/não dos votos do partido na
// mesma votação (o voto dele incluso). Exige ao menos 2 votos sim/não no partido — com um só,
// a "maioria" seria o próprio voto e a resposta seria sempre sim, o que não informa nada.
export function comOPartido(voto: VotoTipo, partido: string | null, sim: number | null, nao: number | null): boolean | null {
  if (voto !== "sim" && voto !== "nao") return null;
  if (partido === null || sim === null || nao === null) return null;
  if (sim + nao < 2 || sim === nao) return null;
  return (sim > nao ? "sim" : "nao") === voto;
}

// Página pública da cota parlamentar do deputado no mês. Esta consulta filtra no servidor
// (redireciona para index.jsp já com deputado e mês); a de /transparencia/gastos-parlamentares
// devolve o mesmo HTML para qualquer mês. Conferido com curl em 27/10/2026.
export function urlCotaCamara(idExterno: string, ano: number, mes: number): string {
  const mmaaaa = `${String(mes).padStart(2, "0")}${ano}`;
  const q = new URLSearchParams({ ideDeputado: idExterno, dataInicio: mmaaaa, dataFim: mmaaaa });
  return `https://www.camara.leg.br/cota-parlamentar/consulta-cota-parlamentar?${q}`;
}

export function urlOficialParlamentar(casa: Casa, idExterno: string): string {
  return casa === "camara"
    ? `https://www.camara.leg.br/deputados/${idExterno}`
    : `https://www25.senado.leg.br/web/senadores/senador/-/perfil/${idExterno}`;
}

// ---- regras dos cards do feed, compartilhadas com apps/export ----

// urlFonte nunca é nula: cai da página mais específica para a mais geral (perfil do parlamentar)
export function urlFonteVoto(votacao: VotacaoResumo, perfil: string): string {
  return votacao.urlOficial ?? votacao.proposicao?.url ?? perfil;
}

export function urlFonteProposicao(proposicao: ProposicaoResumo, perfil: string): string {
  return proposicao.url ?? perfil;
}

// Senado não tem despesa no v1; se vier, o perfil é a página mais específica que há
export function urlFonteDespesa(casa: Casa, idExterno: string | undefined, ano: number, mes: number, perfil: string): string {
  return casa === "camara" && idExterno ? urlCotaCamara(idExterno, ano, mes) : perfil;
}

// primeiro signatário = autor; sem ordem na fonte, autor único também é autor
export function papelAutoria(a: { ordem: number | null; n_autores: number } | undefined): "autor" | "coautor" {
  return a && (a.ordem === 1 || (a.ordem === null && a.n_autores === 1)) ? "autor" : "coautor";
}

export function resumoDespesa(cats: { categoria: string; valor: number }[]): {
  total: number;
  porCategoria: { categoria: string; valor: number }[];
} {
  const ordenadas = [...cats].sort((x, y) => y.valor - x.valor || x.categoria.localeCompare(y.categoria));
  const total = Math.round(ordenadas.reduce((s, c) => s + c.valor, 0) * 100) / 100;
  return { total, porCategoria: ordenadas.slice(0, 5) };
}
