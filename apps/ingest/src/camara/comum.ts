import { sql } from "@plenario/core/db";

export const CASA = "camara" as const;
export const API = "https://dadosabertos.camara.leg.br/api/v2";
export const ARQUIVOS = "https://dadosabertos.camara.leg.br/arquivos";
export const INICIO_LEGISLATURA = "2023-02-01";
export const LEGISLATURA = 57;

export const idCamara = (idExterno: string | number) => `${CASA}:${idExterno}`;

export const urlProposicao = (idExterno: string | number) =>
  `https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=${idExterno}`;

// A Câmara publica data/hora "ingênua" no horário de Brasília (sem horário de verão desde 2019,
// e na 57ª legislatura inteira o offset é -03:00). Gravar com offset explícito evita que o
// timestamptz interprete como UTC.
export function horaBrasilia(naive: string | null | undefined): string | null {
  if (!naive) return null;
  const s = naive.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00-03:00`;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2})?/.exec(s);
  if (!m) return null;
  return `${m[1]}T${m[2]}${m[3] ?? ":00"}-03:00`;
}

/** "AAAA-MM-DD" de hoje no horário de Brasília. */
export function hojeBrasilia(): string {
  return new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
}

export function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function anosEntre(desde: string, ate: string): number[] {
  const anos: number[] = [];
  for (let a = Number(desde.slice(0, 4)); a <= Number(ate.slice(0, 4)); a++) anos.push(a);
  return anos;
}

export interface Periodo {
  desde: string; // AAAA-MM-DD, inclusivo
  ate: string; // AAAA-MM-DD, inclusivo
  /** true quando o período veio do cursor (sem --desde): permite pular arquivo que não mudou */
  incremental: boolean;
}

export const dentro = (dia: string | null | undefined, p: Periodo) =>
  !!dia && dia.slice(0, 10) >= p.desde && dia.slice(0, 10) <= p.ate;

export async function emLotes<T>(itens: T[], tamanho: number, fn: (lote: T[]) => Promise<unknown>) {
  for (let i = 0; i < itens.length; i += tamanho) await fn(itens.slice(i, i + tamanho));
}

export function log(msg: string) {
  const hora = new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" });
  console.log(`[camara ${hora}] ${msg}`);
}

export const fmt = (n: number) => n.toLocaleString("pt-BR");

// ---- ingest_cursor ----

export interface EstadoCursor {
  ultimaData?: string; // AAAA-MM-DD do dado mais novo já gravado
  etags?: Record<string, string>; // arquivo -> etag processado por completo
  [k: string]: unknown;
}

export async function lerCursor(fonte: string): Promise<EstadoCursor | null> {
  const [linha] = await sql<{ estado: EstadoCursor | null }[]>`
    select estado from ingest_cursor where fonte = ${fonte}`;
  return linha ? (linha.estado ?? {}) : null;
}

export async function gravarCursor(fonte: string, estado: EstadoCursor) {
  await sql`
    insert into ingest_cursor (fonte, ultimo_sync, estado)
    values (${fonte}, now(), ${JSON.stringify(estado)}::jsonb)
    on conflict (fonte) do update set ultimo_sync = excluded.ultimo_sync, estado = excluded.estado`;
}

/** Ids `camara:*` de parlamentares já gravados: filtro de FK para votos, autores e despesas. */
export async function idsParlamentares(): Promise<Set<string>> {
  const linhas = await sql<{ id: string }[]>`select id from parlamentar where casa = 'camara'`;
  return new Set(linhas.map((l) => l.id));
}

/** Texto livre da fonte: a Câmara mistura `\r\n` e `\r` soltos nas descrições. */
export function limparTexto(s: string | null | undefined): string | null {
  const t = s?.replace(/\r\n?/g, "\n").trim();
  return t || null;
}
