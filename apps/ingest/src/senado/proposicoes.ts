import { db, schema } from "@plenario/core/db";
import { normalizarBusca } from "@plenario/core/texto";
import { sql as dsql } from "drizzle-orm";
import { buscarJson } from "../http";
import type { SenadorInfo } from "./parlamentares";
import { BASE, dataBrasilia, inteiro, log, urlMateria } from "./util";

// Recorte do v1: projetos que viram norma. Requerimento (REQ/RQS/RQN), indicação (INS),
// recurso, petição etc. ficam de fora: na 57ª são ~10 mil requerimentos contra ~3,3 mil
// projetos, quase todos de rito (informação, sessão solene, desarquivamento), e iam afogar o
// feed. Pra incluir, é só acrescentar a sigla aqui.
export const SIGLAS_PROPOSICAO = new Set(["PL", "PLP", "PEC", "PDL", "PRS"]);

type Executor = Pick<typeof db, "insert">;

export interface ProposicaoLinha {
  id: string;
  casa: "senado";
  idExterno: string;
  siglaTipo: string;
  numero: number | null;
  ano: number | null;
  ementa: string | null;
  dataApresentacao: Date | null;
  url: string;
  atualizadoEm: Date;
}

export function linhaProposicao(p: {
  codigoMateria: string | number;
  sigla: string;
  numero: string | number | null | undefined;
  ano: string | number | null | undefined;
  ementa: string | null | undefined;
  dataApresentacao: string | null | undefined;
}): ProposicaoLinha {
  const cod = String(p.codigoMateria);
  return {
    id: `senado:${cod}`,
    casa: "senado",
    idExterno: cod,
    siglaTipo: p.sigla,
    numero: inteiro(p.numero),
    ano: inteiro(p.ano),
    ementa: p.ementa?.trim() || null,
    dataApresentacao: p.dataApresentacao ? dataBrasilia(p.dataApresentacao.slice(0, 10)) : null,
    url: urlMateria(cod),
    atualizadoEm: new Date(),
  };
}

export async function gravarProposicoes(ex: Executor, linhas: ProposicaoLinha[]): Promise<void> {
  if (linhas.length === 0) return;
  await ex
    .insert(schema.proposicao)
    .values(linhas)
    .onConflictDoUpdate({
      target: schema.proposicao.id,
      set: {
        siglaTipo: dsql`excluded.sigla_tipo`,
        numero: dsql`coalesce(excluded.numero, ${schema.proposicao.numero})`,
        ano: dsql`coalesce(excluded.ano, ${schema.proposicao.ano})`,
        ementa: dsql`coalesce(excluded.ementa, ${schema.proposicao.ementa})`,
        dataApresentacao: dsql`coalesce(excluded.data_apresentacao, ${schema.proposicao.dataApresentacao})`,
        url: dsql`excluded.url`,
        atualizadoEm: dsql`excluded.atualizado_em`,
      },
    });
}

interface ProcessoFonte {
  id: number;
  codigoMateria?: number | null;
  identificacao: string; // "PL 2036/2023"
  ementa?: string | null;
  dataApresentacao?: string | null;
  autoria?: string | null; // "Senador Fulano (PT/SP), Senadora Beltrana (PL/RJ), ..."
  casaIdentificadora?: string;
  objetivo?: string | null; // "Iniciadora" | "Revisora" | "Substitutivo" | "Emenda" | null (PRS)
}

const RE_IDENT = /^(\S+)\s+(\d+)\/(\d{4})/;

// A lista de processos traz a autoria só como texto, na ordem de assinatura. A posição do nome
// do senador nessa lista é a `ordem` (1 = primeiro signatário). Separar por vírgula seguida de
// um tratamento evita quebrar nome que tenha vírgula.
function nomesDaAutoria(autoria: string): string[] {
  return autoria
    .split(/,\s*(?=(?:Senador|Senadora|Deputad[oa]|Comiss|Câmara|Mesa|Presid|Lideran|Bancada|Bloco))/)
    .map((p) =>
      normalizarBusca(
        p
          .replace(/\s*\([^)]*\)\s*$/, "")
          .replace(/^(Senadora?|Deputad[oa])\s+/, ""),
      ),
    );
}

export interface ResultadoProposicoes {
  proposicoes: number;
  autorias: number;
  semOrdem: number;
}

export async function sincronizarProposicoes(
  desde: string,
  ate: string,
  senadores: Map<string, SenadorInfo>,
): Promise<ResultadoProposicoes> {
  const props = new Map<string, ProposicaoLinha>();
  const autorias = new Map<string, { proposicaoId: string; parlamentarId: string; ordem: number | null; data: Date | null; rotulo: string }>();
  let feitos = 0;
  let semOrdem = 0;
  const lista = [...senadores.values()];

  // um pedido por senador: a fonte filtra por código do autor (inclui coautoria), o que dispensa
  // casar nome pra saber QUEM é autor — o nome só é usado pra achar a ordem
  await Promise.all(
    lista.map(async (s) => {
      const url =
        `${BASE}/processo?codigoParlamentarAutor=${s.codigo}` +
        `&dataInicioApresentacao=${desde}&dataFimApresentacao=${ate}`;
      const processos = await buscarJson<ProcessoFonte[] | null>(url);
      const nomeNorm = normalizarBusca(s.nome);
      for (const p of processos ?? []) {
        const m = RE_IDENT.exec(p.identificacao ?? "");
        if (!m || p.codigoMateria == null) continue;
        const sigla = m[1]!;
        if (!SIGLAS_PROPOSICAO.has(sigla)) continue;
        // O filtro por autor também devolve o que chegou da Câmara com o nome dele: projeto que
        // ele apresentou quando era deputado (Revisora) ou substitutivo/emenda da Câmara a um
        // projeto antigo dele. Nada disso foi apresentado por ele no Senado nesta legislatura.
        if (p.objetivo && p.objetivo !== "Iniciadora") continue;
        const data = p.dataApresentacao?.slice(0, 10);
        if (!data || data < desde || data > ate) continue;

        const linha = linhaProposicao({
          codigoMateria: p.codigoMateria,
          sigla,
          numero: m[2],
          ano: m[3],
          ementa: p.ementa,
          dataApresentacao: data,
        });
        props.set(linha.id, linha);

        const pos = nomesDaAutoria(p.autoria ?? "").indexOf(nomeNorm);
        if (pos < 0) semOrdem++;
        const parlamentarId = `senado:${s.codigo}`;
        autorias.set(`${linha.id}|${parlamentarId}`, {
          proposicaoId: linha.id,
          parlamentarId,
          ordem: pos >= 0 ? pos + 1 : null,
          data: linha.dataApresentacao,
          rotulo: `${sigla} ${m[2]}/${m[3]}`,
        });
      }
      feitos++;
      if (feitos % 20 === 0 || feitos === lista.length) {
        log(`proposições: ${feitos}/${lista.length} senadores consultados`);
      }
    }),
  );

  const linhasAutoria = [...autorias.values()];
  const eventos = linhasAutoria
    .filter((a) => a.data !== null)
    .map((a) => ({
      parlamentarId: a.parlamentarId,
      tipo: "proposicao" as const,
      ocorridoEm: a.data!,
      refId: a.proposicaoId,
      resumo: { rotulo: a.rotulo, ordem: a.ordem },
    }));
  // ordem cronológica de inserção: no mesmo instante a API desempata por evento.id
  eventos.sort((a, b) => a.ocorridoEm.getTime() - b.ocorridoEm.getTime() || a.refId.localeCompare(b.refId));

  const LOTE = 1000;
  const propsArr = [...props.values()];
  await db.transaction(async (tx) => {
    for (let i = 0; i < propsArr.length; i += LOTE) await gravarProposicoes(tx, propsArr.slice(i, i + LOTE));
    for (let i = 0; i < linhasAutoria.length; i += LOTE) {
      await tx
        .insert(schema.proposicaoAutor)
        .values(
          linhasAutoria.slice(i, i + LOTE).map((a) => ({
            proposicaoId: a.proposicaoId,
            parlamentarId: a.parlamentarId,
            ordem: a.ordem,
            proponente: true,
          })),
        )
        .onConflictDoUpdate({
          target: [schema.proposicaoAutor.proposicaoId, schema.proposicaoAutor.parlamentarId],
          set: {
            ordem: dsql`coalesce(excluded.ordem, ${schema.proposicaoAutor.ordem})`,
            proponente: dsql`excluded.proponente`,
          },
        });
    }
    for (let i = 0; i < eventos.length; i += LOTE) {
      await tx
        .insert(schema.evento)
        .values(eventos.slice(i, i + LOTE))
        .onConflictDoUpdate({
          target: [schema.evento.parlamentarId, schema.evento.tipo, schema.evento.refId],
          set: { ocorridoEm: dsql`excluded.ocorrido_em`, resumo: dsql`excluded.resumo` },
        });
    }
  });

  return { proposicoes: props.size, autorias: linhasAutoria.length, semOrdem };
}
