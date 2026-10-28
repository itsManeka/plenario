/**
 * Sync das consultas publicas do e-Cidadania (I/O). Regras puras em consultas_regras.ts;
 * decisoes em docs/consultas-publicas.md. Nao grava o cursor: devolve o mapa de puladas e os
 * contadores para quem chama (index.ts) gravar tudo numa unica `gravarCursor`.
 */
import { db, schema } from "@plenario/core/db";
import { eq, inArray, sql as dsql } from "drizzle-orm";
import { buscarTexto } from "../http";
import { criarThrottleConsultas } from "../throttle";
import { lerConsulta, urlConsulta } from "./consulta_parser";
import {
  classificarResposta,
  deveAbortar,
  devePularPorRegistro,
  leituraDoResultado,
  montarEvento,
  ordenarCandidatas,
  podarPuladas,
  proximaContagemFalhas,
  type AutorOrdem,
  type Candidata,
  type Desfecho,
  type Puladas,
} from "./consultas_regras";
import { lerCursor } from "./cursor";
import { log } from "./util";

export const FONTE_CURSOR_CONSULTAS = "senado:consultas";
export const VAR_TETO_CONSULTAS = "INGEST_CONSULTAS_MAX";
export const TETO_CONSULTAS_PADRAO = 500;

export interface ResultadoConsultas {
  lidas: number;
  puladas: number;
  eventos: number;
  falhas: number;
  abortou: boolean;
  /** Mapa novo (podado + pulos desta rodada) para o chamador gravar no cursor `senado:consultas`. */
  registroPuladas: Puladas;
}

/** Ausente, vazio ou nao inteiro positivo = padrao. */
export function lerTetoConsultas(env: Readonly<Record<string, string | undefined>>): number {
  const bruto = env[VAR_TETO_CONSULTAS]?.trim();
  if (!bruto) return TETO_CONSULTAS_PADRAO;
  const n = Number(bruto);
  return Number.isSafeInteger(n) && n > 0 ? n : TETO_CONSULTAS_PADRAO;
}

interface CandidataLinha extends Candidata {
  idExterno: string;
}

function puladasDoCursor(estado: Record<string, unknown> | null): Puladas {
  const bruto = estado?.puladas;
  if (typeof bruto !== "object" || bruto === null || Array.isArray(bruto)) return {};
  const saida: Puladas = {};
  for (const [cod, r] of Object.entries(bruto as Record<string, unknown>)) {
    if (typeof r !== "object" || r === null) continue;
    const { em, motivo } = r as { em?: unknown; motivo?: unknown };
    if (typeof em !== "string" || Number.isNaN(Date.parse(em))) continue;
    if (motivo !== "encerrada" && motivo !== "materia_inexistente") continue;
    saida[cod] = { em, motivo };
  }
  return saida;
}

export async function sincronizarConsultas(): Promise<ResultadoConsultas> {
  const agora = new Date();
  const teto = lerTetoConsultas(process.env);
  const estado = await lerCursor(FONTE_CURSOR_CONSULTAS);
  const registro = podarPuladas(puladasDoCursor(estado), agora);

  const linhas = await db
    .select({
      proposicaoId: schema.proposicao.id,
      idExterno: schema.proposicao.idExterno,
      apuradoEm: schema.consultaPublica.apuradoEm,
    })
    .from(schema.proposicao)
    .leftJoin(schema.consultaPublica, eq(schema.consultaPublica.proposicaoId, schema.proposicao.id))
    .where(eq(schema.proposicao.casa, "senado"));

  const elegiveis: CandidataLinha[] = linhas.filter((l) => !devePularPorRegistro(registro[l.idExterno], agora));
  const selecionadas = ordenarCandidatas(elegiveis).slice(0, teto);

  const autoresPorProposicao = new Map<string, AutorOrdem[]>();
  if (selecionadas.length > 0) {
    const autores = await db
      .select({
        proposicaoId: schema.proposicaoAutor.proposicaoId,
        parlamentarId: schema.proposicaoAutor.parlamentarId,
        ordem: schema.proposicaoAutor.ordem,
      })
      .from(schema.proposicaoAutor)
      .where(
        inArray(
          schema.proposicaoAutor.proposicaoId,
          selecionadas.map((c) => c.proposicaoId),
        ),
      );
    for (const a of autores) {
      const lista = autoresPorProposicao.get(a.proposicaoId) ?? [];
      lista.push({ parlamentarId: a.parlamentarId, ordem: a.ordem });
      autoresPorProposicao.set(a.proposicaoId, lista);
    }
  }

  const throttle = criarThrottleConsultas();
  const novasPuladas: Puladas = { ...registro };
  let lidas = 0;
  let puladas = 0;
  let eventos = 0;
  let falhas = 0;
  let seguidas = 0;
  let abortou = false;

  const pular = (cod: string, motivo: string): Desfecho => {
    puladas++;
    log(`consultas: pulou ${cod} (${motivo})`);
    return "pulo_esperado";
  };
  const falhar = (cod: string, motivo: string): Desfecho => {
    puladas++;
    falhas++;
    log(`consultas: falhou ${cod} (${motivo})`);
    return "falha";
  };

  for (const c of selecionadas) {
    const cod = Number(c.idExterno);
    if (!Number.isSafeInteger(cod) || cod <= 0) {
      pular(c.idExterno, "codigo invalido");
      continue;
    }
    let desfecho: Desfecho;
    try {
      await throttle.esperar();
      const resp = await buscarTexto(urlConsulta(cod));
      const cls = classificarResposta(resp, cod);
      if (cls.acao === "pular") {
        desfecho = pular(c.idExterno, cls.motivo);
        if (cls.motivo === "materia_inexistente") {
          novasPuladas[c.idExterno] = { em: new Date().toISOString(), motivo: "materia_inexistente" };
        }
      } else {
        const r = lerConsulta(cls.html, cod);
        if (r.tipo === "sem_dado") {
          desfecho = pular(c.idExterno, `sem_dado:${r.motivo}`);
          if (r.motivo === "encerrada") {
            novasPuladas[c.idExterno] = { em: new Date().toISOString(), motivo: "encerrada" };
          }
        } else {
          const v = leituraDoResultado(r, cod);
          if (!v.ok) {
            desfecho = falhar(c.idExterno, v.motivo);
          } else {
            const evento = montarEvento({
              proposicaoId: c.proposicaoId,
              autores: autoresPorProposicao.get(c.proposicaoId) ?? [],
              leitura: v.leitura,
            });
            const l = v.leitura;
            const resultado = await db.transaction(async (tx) => {
              // leitura mais antiga que a gravada nao sobrescreve (setWhere) nem gera evento
              const gravadas = await tx
                .insert(schema.consultaPublica)
                .values({
                  materiaCod: String(l.cod),
                  proposicaoId: c.proposicaoId,
                  votosSim: l.votosSim,
                  votosNao: l.votosNao,
                  apuradoEm: l.apuradoEm,
                  urlFonte: l.urlFonte,
                })
                .onConflictDoUpdate({
                  target: schema.consultaPublica.materiaCod,
                  set: {
                    proposicaoId: dsql`excluded.proposicao_id`,
                    votosSim: dsql`excluded.votos_sim`,
                    votosNao: dsql`excluded.votos_nao`,
                    apuradoEm: dsql`excluded.apurado_em`,
                    urlFonte: dsql`excluded.url_fonte`,
                    atualizadoEm: dsql`now()`,
                  },
                  setWhere: dsql`${schema.consultaPublica.apuradoEm} <= excluded.apurado_em`,
                })
                .returning({ materiaCod: schema.consultaPublica.materiaCod });
              if (gravadas.length === 0 || evento === null) return { gravou: gravadas.length > 0, evento: 0 };
              const novos = await tx
                .insert(schema.evento)
                .values(evento)
                .onConflictDoNothing({
                  target: [schema.evento.parlamentarId, schema.evento.tipo, schema.evento.refId],
                })
                .returning({ id: schema.evento.id });
              return { gravou: true, evento: novos.length };
            });
            if (resultado.gravou) {
              lidas++;
              eventos += resultado.evento;
              desfecho = "ok";
            } else {
              desfecho = pular(c.idExterno, "leitura mais antiga que a gravada");
            }
          }
        }
      }
    } catch (e) {
      desfecho = falhar(c.idExterno, e instanceof Error ? e.message : String(e));
    }
    seguidas = proximaContagemFalhas(seguidas, desfecho);
    if (deveAbortar(seguidas)) {
      abortou = true;
      log(`consultas: abortou a rodada apos ${seguidas} falhas seguidas`);
      break;
    }
  }

  return { lidas, puladas, eventos, falhas, abortou, registroPuladas: novasPuladas };
}
