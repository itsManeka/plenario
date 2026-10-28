/**
 * Parser puro da pagina de consulta publica do e-Cidadania (sem I/O, sem dependencia).
 * Regras: docs/consultas-publicas.md ("Regras para o parser"). Nunca lanca; ausencia ou
 * formato inesperado e `template_alterado`, nunca zero.
 */

export type MotivoSemDado = "encerrada" | "sem_apuracao";

export type ResultadoConsulta =
  | { tipo: "ok"; votosSim: number; votosNao: number; apuradoEm: Date }
  | { tipo: "sem_dado"; motivo: MotivoSemDado }
  | { tipo: "template_alterado"; detalhe: string };

const BASE_URL = "https://www12.senado.leg.br/ecidadania/visualizacaomateria";

export function urlConsulta(cod: number): string {
  return `${BASE_URL}?id=${cod}`;
}

const alterado = (detalhe: string): ResultadoConsulta => ({ tipo: "template_alterado", detalhe });

/** Elemento cujo atributo class contem o token informado. */
const temClasse = (classes: string, token: string): boolean => classes.split(/\s+/).includes(token);

function lerAttr(tag: string, nome: string): string | null {
  const m = new RegExp(`(?:^|\\s)${nome}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? "") : null;
}

function textoLimpo(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const RE_VALOR = /^\d{1,3}(\.\d{3})*$/;

function lerContagem(texto: string): number | null {
  const t = texto.trim();
  if (!RE_VALOR.test(t)) return null;
  const n = Number(t.replace(/\./g, ""));
  return Number.isSafeInteger(n) ? n : null;
}

/** "dd/mm/aaaa hh:mm:ss" em America/Sao_Paulo (offset fixo -03:00). Data impossivel = null. */
function lerApuracao(texto: string): Date | null {
  const m = /^Votos apurados até\s+(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/.exec(texto);
  if (!m) return null;
  const [dia, mes, ano, hora, min, seg] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (hora > 23 || min > 59 || seg > 59) return null;
  const local = new Date(Date.UTC(ano, mes - 1, dia, hora, min, seg));
  if (
    local.getUTCFullYear() !== ano ||
    local.getUTCMonth() !== mes - 1 ||
    local.getUTCDate() !== dia
  ) {
    return null;
  }
  return new Date(local.getTime() + 3 * 3600 * 1000);
}

function lerConsultaInterno(html: string, codEsperado: number): ResultadoConsulta {
  // Regra 1: comentarios HTML saem antes de qualquer busca.
  const limpo = html.replace(/<!--[\s\S]*?(?:-->|$)/g, "");

  // Regra 5: identidade (precede `encerrada`).
  const ids = (limpo.match(/<input\b[^>]*>/gi) ?? []).filter((tag) => lerAttr(tag, "id") === "materiaId");
  if (ids.length !== 1) return alterado("input#materiaId ausente ou duplicado");
  const valorId = (lerAttr(ids[0] as string, "value") ?? "").trim();
  if (!/^\d+$/.test(valorId) || Number(valorId) !== codEsperado) {
    return alterado(`materiaId diferente do esperado (${codEsperado})`);
  }

  // Regra 4: tramitacao encerrada.
  for (const tag of limpo.match(/<[a-z][^>]*>/gi) ?? []) {
    const cls = lerAttr(tag, "class");
    if (cls !== null && temClasse(cls, "tramitacao-encerrada")) {
      return { tipo: "sem_dado", motivo: "encerrada" };
    }
  }

  // Regra 3: apuracao.
  const msg = /<div\b[^>]*\bid\s*=\s*["']msg-contabilizacao-voto["'][^>]*>([\s\S]*?)<\/div>/i.exec(limpo);
  if (!msg) return { tipo: "sem_dado", motivo: "sem_apuracao" };
  const apuradoEm = lerApuracao(textoLimpo(msg[1] as string));
  if (!apuradoEm) return alterado("data de apuracao ausente ou invalida");

  // Regra 2: placar, so nos spans do footer do figure (nunca a largura da barra).
  const figura =
    /<figure\b([^>]*)>([\s\S]*?)<\/figure>/gi;
  let rodape: string | null = null;
  for (const f of limpo.matchAll(figura)) {
    const cls = lerAttr(f[1] as string, "class");
    if (cls !== null && temClasse(cls, "grafico-consulta-publica")) {
      const foot = /<footer\b[^>]*>([\s\S]*?)<\/footer>/i.exec(f[2] as string);
      if (foot) rodape = foot[1] as string;
      break;
    }
  }
  if (rodape === null) return alterado("bloco do placar ausente");

  const favor: string[] = [];
  const contra: string[] = [];
  for (const s of rodape.matchAll(/<span\b([^>]*)>([\s\S]*?)<\/span>/gi)) {
    const cls = lerAttr(s[1] as string, "class");
    if (cls === null) continue;
    if (temClasse(cls, "contabilizacao-favor")) favor.push(s[2] as string);
    if (temClasse(cls, "contabilizacao-contra")) contra.push(s[2] as string);
  }
  if (favor.length !== 1 || contra.length !== 1) return alterado("spans do placar ausentes ou duplicados");
  const votosSim = lerContagem(favor[0] as string);
  const votosNao = lerContagem(contra[0] as string);
  if (votosSim === null || votosNao === null) return alterado("valor do placar fora do formato");

  return { tipo: "ok", votosSim, votosNao, apuradoEm };
}

/** Le o placar de `visualizacaomateria?id=<codEsperado>`. Nunca lanca. */
export function lerConsulta(html: string, codEsperado: number): ResultadoConsulta {
  try {
    if (typeof html !== "string") return alterado("entrada nao e texto");
    return lerConsultaInterno(html, codEsperado);
  } catch {
    return alterado("falha inesperada ao ler o HTML");
  }
}
