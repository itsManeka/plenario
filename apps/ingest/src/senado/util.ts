// Utilitários do ingest do Senado: datas, janelas e o tratamento de "1 item vem como objeto,
// vários vêm como array" que a API do Senado faz em quase todo endpoint.

export const INICIO_LEGISLATURA = "2023-02-01";
export const LEGISLATURA = 57;
export const BASE = "https://legis.senado.leg.br/dadosabertos";

export function comoLista<T>(v: T | T[] | null | undefined): T[] {
  if (v === null || v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

export function log(msg: string): void {
  console.log(`[senado] ${msg}`);
}

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;

export function validarData(d: string, nome: string): string {
  if (!RE_DATA.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) {
    throw new Error(`--${nome} inválido: "${d}" (use AAAA-MM-DD)`);
  }
  return d;
}

export function hojeBrasilia(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

export function somarDias(d: string, dias: number): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + dias);
  return t.toISOString().slice(0, 10);
}

export function maiorData(a: string, b: string): string {
  return a > b ? a : b;
}

// A API recusa intervalo > 1 ano (e às vezes devolve 503 em vez de 400 perto do limite).
// Janelas curtas também deixam o progresso legível.
export function janelas(desde: string, ate: string, dias: number): [string, string][] {
  const out: [string, string][] = [];
  let ini = desde;
  while (ini <= ate) {
    const candidato = somarDias(ini, dias - 1);
    const fim = candidato < ate ? candidato : ate;
    out.push([ini, fim]);
    ini = somarDias(fim, 1);
  }
  return out;
}

// O Senado publica só horário de Brasília. Desde 2019 não há horário de verão, então todo o
// período da 57ª legislatura é UTC-3 fixo.
export function dataBrasilia(data: string, hora = "00:00:00"): Date {
  return new Date(`${data}T${hora}-03:00`);
}

// "14/10/2026 16:29:28" -> Date (horário de Brasília)
export function dataHoraBrBarra(s: string | null | undefined): Date | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}:\d{2}(?::\d{2})?)$/.exec(s?.trim() ?? "");
  if (!m) return null;
  const hora = m[4]!.length === 5 ? `${m[4]}:00` : m[4]!;
  const d = dataBrasilia(`${m[3]}-${m[2]}-${m[1]}`, hora);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function urlMateria(codigoMateria: string | number): string {
  return `https://www25.senado.leg.br/web/atividade/materias/-/materia/${codigoMateria}`;
}

export function inteiro(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}
