import type { Casa, ParlamentarResumo, VotacaoResumo, VotoTipo } from "@plenario/core/api";

const TZ = "America/Sao_Paulo";
const LOCALE = "pt-BR";

const fmtDataHora = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TZ,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const fmtData = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TZ,
  day: "numeric",
  month: "long",
  year: "numeric",
});
const fmtDataCurta = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TZ,
  day: "numeric",
  month: "short",
});
const fmtDataCurtaAno = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TZ,
  day: "numeric",
  month: "short",
  year: "numeric",
});
const fmtAno = new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, year: "numeric" });
const fmtBRL = new Intl.NumberFormat(LOCALE, { style: "currency", currency: "BRL" });
const fmtBRLInteiro = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});
const fmtNum = new Intl.NumberFormat(LOCALE);
const fmtPct = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });
const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });

/** "27/10/2026 14:05" (horário de Brasília). */
export function dataHora(iso: string): string {
  return fmtDataHora.format(new Date(iso));
}

/** "27 de outubro de 2026". */
export function dataExtenso(iso: string): string {
  return fmtData.format(new Date(iso));
}

/** Atributo `title` dos tempos relativos: data absoluta completa. */
export function dataTitulo(iso: string): string {
  return `${fmtDataHora.format(new Date(iso))} (horário de Brasília)`;
}

/** "há 3 dias", "há 2 horas", "ontem"; passa a data curta depois de 30 dias. */
export function tempoRelativo(iso: string, agora: Date = new Date()): string {
  const d = new Date(iso);
  const seg = Math.round((d.getTime() - agora.getTime()) / 1000);
  const abs = Math.abs(seg);
  if (abs < 60) return "agora";
  if (abs < 3600) return rtf.format(Math.round(seg / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(seg / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(seg / 86400), "day");
  const mesmoAno = fmtAno.format(d) === fmtAno.format(agora);
  return (mesmoAno ? fmtDataCurta : fmtDataCurtaAno).format(d).replace(/\./g, "");
}

const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/** mes 1–12 -> "setembro de 2026". */
export function mesAno(mes: number, ano: number): string {
  return `${MESES[mes - 1] ?? mes} de ${ano}`;
}

export function brl(valor: number): string {
  return fmtBRL.format(valor);
}

export function brlInteiro(valor: number): string {
  return fmtBRLInteiro.format(valor);
}

export function num(valor: number): string {
  return fmtNum.format(valor);
}

export function pct(valor: number): string {
  return `${fmtPct.format(valor)}%`;
}

export const CASA_NOME: Record<Casa, string> = {
  camara: "Câmara",
  senado: "Senado",
};

export const CASA_CARGO: Record<Casa, string> = {
  camara: "Deputado(a) federal",
  senado: "Senador(a)",
};

/** "PXA-SP", "PXA", "SP" ou "Sem partido". */
export function partidoUf(p: Pick<ParlamentarResumo, "partido" | "uf">): string {
  if (p.partido && p.uf) return `${p.partido}-${p.uf}`;
  return p.partido ?? p.uf ?? "Sem partido";
}

export const VOTO_ROTULO: Record<VotoTipo, string> = {
  sim: "Sim",
  nao: "Não",
  abstencao: "Abstenção",
  obstrucao: "Obstrução",
  art17: "Art. 17",
  ausente: "Ausente",
  outro: "Outro",
};

export const VOTO_DESCRICAO: Record<VotoTipo, string> = {
  sim: "Sim",
  nao: "Não",
  abstencao: "Abstenção",
  obstrucao: "Obstrução",
  art17: "Art. 17 do Regimento: presidência da sessão não vota",
  ausente: "Ausente: não registrou voto",
  outro: "Outro registro",
};

export function iniciais(nome: string): string {
  const partes = nome
    .split(/\s+/)
    .filter((p) => p.length > 2 || /^[A-ZÀ-Ú]/.test(p))
    .filter(Boolean);
  const a = partes[0]?.[0] ?? "?";
  const b = partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? "") : "";
  return (a + b).toUpperCase();
}

/** Mesma normalização do back, para filtrar listas no cliente. */
export { normalizarBusca as normalizar } from "@plenario/core/texto";

export function plural(n: number, um: string, varios: string): string {
  return `${num(n)} ${n === 1 ? um : varios}`;
}

/** "COMBUSTÍVEIS E LUBRIFICANTES." (como vem da CEAP) -> "Combustíveis e lubrificantes". */
export function categoriaDespesa(s: string): string {
  const t = s.trim().replace(/\.+$/, "");
  if (t !== t.toLocaleUpperCase("pt-BR")) return t;
  const baixo = t.toLocaleLowerCase("pt-BR");
  return baixo.charAt(0).toLocaleUpperCase("pt-BR") + baixo.slice(1);
}

const fmtMesAnoSP = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit" });

/** O mês/ano informado é o mês corrente em Brasília (dado ainda parcial)? */
export function mesCorrente(mes: number, ano: number, agora: Date = new Date()): boolean {
  return fmtMesAnoSP.format(agora) === `${ano}-${String(mes).padStart(2, "0")}`;
}

const fmtDataNum = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TZ,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/** "14/10/2026" (horário de Brasília). */
export function dataNumerica(iso: string): string {
  return fmtDataNum.format(new Date(iso));
}

/**
 * Quando a votação ocorreu. Com `dataHoraAproximada` (Senado: a fonte só dá o início da
 * Ordem do Dia) mostra só a data da sessão, sem inventar hora.
 */
export function quandoVotacao(v: Pick<VotacaoResumo, "dataHora" | "dataHoraAproximada">): string {
  return v.dataHoraAproximada ? `na sessão de ${dataNumerica(v.dataHora)}` : dataHora(v.dataHora);
}

/** Código de órgão da fonte para exibição: só PLEN tem nome conhecido. */
export function orgaoNome(codigo: string): string {
  return codigo.toUpperCase() === "PLEN" ? "Plenário" : codigo;
}

// Quórum de aprovação (votos sim) por casa e tipo. Só PEC e PLP; o resto é maioria simples.
const QUORUM: Record<Casa, Record<"PEC" | "PLP", number>> = {
  camara: { PLP: 257, PEC: 308 },
  senado: { PLP: 41, PEC: 49 },
};

/**
 * Nota neutra quando o resultado contradiz a maioria simples do placar e a proposição é
 * PEC/PLP (ex.: "Rejeitada · 252 sim, 176 não"). Não calcula nada além do que o contrato dá.
 */
export function notaQuorum(
  v: Pick<VotacaoResumo, "casa" | "aprovada" | "placar" | "proposicao" | "orgao">,
): string | null {
  // quórum qualificado é regra do Plenário; em comissão (ex.: CMADS) a nota seria falsa
  if (v.orgao?.toUpperCase() !== "PLEN") return null;
  const sigla = v.proposicao?.siglaTipo.toUpperCase();
  if (sigla !== "PEC" && sigla !== "PLP") return null;
  if (v.aprovada === null || !v.placar) return null;
  const maioriaSimples = v.placar.sim > v.placar.nao;
  if (v.aprovada === maioriaSimples) return null;
  const casa = v.casa === "camara" ? "na Câmara" : "no Senado";
  return `Exige maioria qualificada (${sigla} ${casa}: ${num(QUORUM[v.casa][sigla])} votos sim)`;
}
