import { db, schema } from "@plenario/core/db";
import { normalizarBusca } from "@plenario/core/texto";
import { sql as dsql } from "drizzle-orm";
import { buscarJson } from "../http";
import type { SenadorInfo } from "./parlamentares";
import { gravarProposicoes, linhaProposicao } from "./proposicoes";
import { BASE, comoLista, dataBrasilia, dataHoraBrBarra, janelas, log } from "./util";

type VotoTipo = (typeof schema.votoEnum.enumValues)[number];

interface VotoFonte {
  codigoParlamentar: number | string;
  nomeParlamentar?: string;
  siglaPartidoParlamentar?: string | null;
  siglaUFParlamentar?: string | null;
  siglaVotoParlamentar?: string | null;
  descricaoVotoParlamentar?: string | null;
}

interface VotacaoFonte {
  codigoSessaoVotacao: number;
  codigoSessao?: number | null;
  sequencialSessao?: number | null;
  casaSessao?: string | null;
  codigoMateria?: number | null;
  sigla?: string | null;
  numero?: string | null;
  ano?: number | null;
  ementa?: string | null;
  dataApresentacao?: string | null;
  identificacao?: string | null;
  dataSessao: string; // AAAA-MM-DD, sem hora
  descricaoVotacao?: string | null;
  resultadoVotacao?: string | null; // "A" aprovada | "R" rejeitada
  votacaoSecreta?: string | null; // "S" | "N"
  totalVotosSim?: number | null;
  totalVotosNao?: number | null;
  totalVotosAbstencao?: number | null;
  votos?: VotoFonte | VotoFonte[] | null;
}

// Mapeamento das siglas de voto do Senado. A tabela oficial de siglas está em
// /plenario/lista/tiposComparecimento; o critério é "o que a pessoa fez naquela votação":
//   Sim / Não / Abstenção                     -> sim / nao / abstencao
//   "Presidente (art. 51 RISF)", PR, PS        -> art17 (presidiu: pelo regimento não vota)
//   OB, P-OD (obstrução declarada)             -> obstrucao
//   P-NRV "Presente – Não registrou voto", NR -> outro. Estava no plenário e não votou; NÃO é o
//       presidente (há ~12 P-NRV por votação, e o presidente vem com sigla própria).
//   AP, MIS, licenças (LS, LP, LAP, L1–L7…), NCom, NA e afins -> ausente. NA tem a mesma
//       descrição de L7 ("Dispositivo não citado"): é licença com fundamento não informado.
// Sigla fora da tabela cai em "outro", com aviso no log; o texto cru fica em voto_original.
const ART17 = new Set(["PR", "PS"]);
const OBSTRUCAO = new Set(["OB", "P-OD", "Obstrução"]);
const PRESENTE_SEM_VOTO = new Set(["P-NRV", "NR", "PSF", "SF", "VO", "Votou"]);
const AUSENCIAS = new Set([
  "AFO", "AP", "AUS", "CAS", "DIS", "DJ", "EP", "EPR", "FAL", "GR", "IL", "IMP",
  "L1", "L2", "L3", "L4", "L5", "L6", "L7", "LA", "LAF", "LAP", "LC", "LCS", "LEG", "LG",
  "LGA", "LL", "LN", "LP", "LPA", "LS", "LSP", "MER", "MIS", "NA", "NCom", "PER", "REN",
  "REP", "RET", "TER",
]);

export function normalizarVoto(sigla: string | null | undefined): VotoTipo {
  const s = (sigla ?? "").trim();
  if (s === "Sim") return "sim";
  if (s === "Não") return "nao";
  if (s === "Abstenção") return "abstencao";
  if (s.startsWith("Presidente") || ART17.has(s)) return "art17";
  if (OBSTRUCAO.has(s)) return "obstrucao";
  if (AUSENCIAS.has(s)) return "ausente";
  return "outro";
}

const siglasDesconhecidas = new Set<string>();
function conhecida(s: string): boolean {
  return (
    ["Sim", "Não", "Abstenção"].includes(s) ||
    s.startsWith("Presidente") ||
    ART17.has(s) ||
    OBSTRUCAO.has(s) ||
    PRESENTE_SEM_VOTO.has(s) ||
    AUSENCIAS.has(s)
  );
}

// ---- horário da sessão ----------------------------------------------------------------------
// A lista de votações só traz a data. O horário mais próximo que a fonte publica é o início da
// Ordem do Dia (onde as votações acontecem) no resumo da sessão; na falta, o início da sessão,
// depois a hora prevista. Não inventamos minuto: votações da mesma sessão ficam com o mesmo
// instante, e a ordem entre elas sai da ordem de inserção (evento.id).

interface EventoSessao {
  dataEvento?: string;
}
interface ParteSessao {
  tipoParte?: { descricao?: string; nome?: string };
  eventoInicio?: EventoSessao | null;
}
interface EncontroResumo {
  dataPrevista?: string;
  encontroRealizado?: {
    eventoInicio?: EventoSessao | null;
    partes?: { parte?: ParteSessao | ParteSessao[] } | null;
  } | null;
}
interface RespResumo {
  ServicoPlenario?: { encontros?: { encontro?: EncontroResumo | EncontroResumo[] } };
}

const horaSessaoCache = new Map<number, Promise<Date | null>>();

function horaDaSessao(codigoSessao: number): Promise<Date | null> {
  let p = horaSessaoCache.get(codigoSessao);
  if (!p) {
    p = buscarJson<RespResumo>(`${BASE}/plenario/encontro/${codigoSessao}/resumo`)
      .then((r) => {
        const enc = comoLista(r.ServicoPlenario?.encontros?.encontro)[0];
        if (!enc) return null;
        const real = enc.encontroRealizado;
        const ordemDoDia = comoLista(real?.partes?.parte).find((pt) =>
          /ordem do dia/i.test(pt.tipoParte?.descricao ?? pt.tipoParte?.nome ?? ""),
        );
        return (
          dataHoraBrBarra(ordemDoDia?.eventoInicio?.dataEvento) ??
          dataHoraBrBarra(real?.eventoInicio?.dataEvento) ??
          dataHoraBrBarra(enc.dataPrevista)
        );
      })
      .catch((e: unknown) => {
        log(`aviso: sem horário da sessão ${codigoSessao} (${String(e)}); usando só a data`);
        return null;
      });
    horaSessaoCache.set(codigoSessao, p);
  }
  return p;
}

async function dataHoraVotacao(v: VotacaoFonte): Promise<Date> {
  const data = v.dataSessao.slice(0, 10);
  const hora = v.codigoSessao ? await horaDaSessao(v.codigoSessao) : null;
  // a hora tem que ser do mesmo dia; sessão que vira a meia-noite fica com a data da votação
  if (hora && new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(hora) === data) {
    return hora;
  }
  return dataBrasilia(data);
}

// Página pública da votação. O site do Senado não tem página própria por votação: o link que
// ele mesmo usa (na pauta da sessão) é a lista de votações da matéria com âncora na votação,
// que existe também nas secretas. Sem matéria, cai na pauta da sessão, que lista as nominais.
function urlVotacao(v: VotacaoFonte): string | null {
  if (v.codigoMateria) {
    return `https://www25.senado.leg.br/web/atividade/materias/-/materia/${v.codigoMateria}/votacoes#votacao_${v.codigoSessaoVotacao}`;
  }
  if (v.codigoSessao) return `https://www25.senado.leg.br/web/atividade/sessao-plenaria/-/pauta/${v.codigoSessao}`;
  return null;
}

// ---- gravação -------------------------------------------------------------------------------

export interface ResultadoVotacoes {
  votacoes: number;
  nominais: number;
  secretas: number;
  votos: number;
}

async function gravarVotacao(
  v: VotacaoFonte,
  dataHora: Date,
  senadores: Map<string, SenadorInfo>,
  r: ResultadoVotacoes,
): Promise<void> {
  const id = `senado:${v.codigoSessaoVotacao}`;
  // Votação secreta (autoridades, embaixadores, vetos antigos): a fonte lista os 81, mas o voto
  // de cada um vem só como "Votou". Sem voto individual ela entra como não nominal — mesmo
  // tratamento da simbólica: tem placar, não tem card no feed.
  const secreta = v.votacaoSecreta === "S";
  const votos = secreta ? [] : comoLista(v.votos);
  const nominal = !secreta && votos.length > 0;

  const linhasVoto = votos.map((x) => {
    const cod = String(x.codigoParlamentar);
    const original = x.siglaVotoParlamentar?.trim() || null;
    if (original && !conhecida(original) && !siglasDesconhecidas.has(original)) {
      siglasDesconhecidas.add(original);
      log(`aviso: sigla de voto desconhecida "${original}" (${x.descricaoVotoParlamentar ?? "sem descrição"}) -> outro`);
    }
    return {
      votacaoId: id,
      parlamentarId: `senado:${cod}`,
      codigo: cod,
      nome: x.nomeParlamentar?.trim() || cod,
      uf: x.siglaUFParlamentar ?? null,
      voto: normalizarVoto(original),
      votoOriginal: original,
      partidoNaHora: x.siglaPartidoParlamentar?.trim() || null,
    };
  });

  let placarSim: number | null;
  let placarNao: number | null;
  let placarOutros: number | null;
  if (nominal) {
    // mesmo critério do "Total" que o Senado publica no informe: Sim + Não + Abstenção + Presidente
    placarSim = linhasVoto.filter((x) => x.voto === "sim").length;
    placarNao = linhasVoto.filter((x) => x.voto === "nao").length;
    placarOutros = linhasVoto.filter((x) => ["abstencao", "art17", "obstrucao"].includes(x.voto)).length;
  } else {
    placarSim = v.totalVotosSim ?? null;
    placarNao = v.totalVotosNao ?? null;
    placarOutros = v.totalVotosAbstencao ?? null;
  }

  const rotulo =
    v.sigla && v.numero && v.ano ? `${v.sigla} ${v.numero}/${v.ano}` : (v.identificacao ?? null);
  const proposicaoId = v.codigoMateria ? `senado:${v.codigoMateria}` : null;

  await db.transaction(async (tx) => {
    if (v.codigoMateria && v.sigla) {
      await gravarProposicoes(tx, [
        linhaProposicao({
          codigoMateria: v.codigoMateria,
          sigla: v.sigla,
          numero: v.numero,
          ano: v.ano,
          ementa: v.ementa,
          dataApresentacao: v.dataApresentacao,
        }),
      ]);
    }

    await tx
      .insert(schema.votacao)
      .values({
        id,
        casa: "senado",
        idExterno: String(v.codigoSessaoVotacao),
        dataHora,
        orgao: "PLEN", // este endpoint só publica votações do Plenário do Senado
        descricao: v.descricaoVotacao?.trim() || rotulo,
        proposicaoId: v.codigoMateria && v.sigla ? proposicaoId : null,
        aprovada: v.resultadoVotacao === "A" ? true : v.resultadoVotacao === "R" ? false : null,
        nominal,
        placarSim,
        placarNao,
        placarOutros,
        secreta,
        // o horário é o início da Ordem do Dia (ou da sessão), nunca o do painel de votação
        dataHoraAproximada: true,
        url: urlVotacao(v),
        atualizadoEm: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.votacao.id,
        set: {
          dataHora: dsql`excluded.data_hora`,
          orgao: dsql`excluded.orgao`,
          descricao: dsql`excluded.descricao`,
          proposicaoId: dsql`excluded.proposicao_id`,
          aprovada: dsql`excluded.aprovada`,
          nominal: dsql`excluded.nominal`,
          placarSim: dsql`excluded.placar_sim`,
          placarNao: dsql`excluded.placar_nao`,
          placarOutros: dsql`excluded.placar_outros`,
          secreta: dsql`excluded.secreta`,
          dataHoraAproximada: dsql`excluded.data_hora_aproximada`,
          url: dsql`excluded.url`,
          atualizadoEm: dsql`excluded.atualizado_em`,
        },
      });

    if (linhasVoto.length === 0) return;

    // votante fora da lista da 57ª (só acontece com --desde anterior a 2023): cria o mínimo
    const faltando = linhasVoto.filter((x) => !senadores.has(x.codigo));
    if (faltando.length > 0) {
      await tx
        .insert(schema.parlamentar)
        .values(
          faltando.map((x) => ({
            id: x.parlamentarId,
            casa: "senado" as const,
            idExterno: x.codigo,
            nome: x.nome,
            partido: x.partidoNaHora,
            uf: x.uf,
            emExercicio: false,
            busca: normalizarBusca(x.nome),
          })),
        )
        .onConflictDoNothing();
    }

    await tx
      .insert(schema.voto)
      .values(
        linhasVoto.map((x) => ({
          votacaoId: x.votacaoId,
          parlamentarId: x.parlamentarId,
          voto: x.voto,
          votoOriginal: x.votoOriginal,
          partidoNaHora: x.partidoNaHora,
        })),
      )
      .onConflictDoUpdate({
        target: [schema.voto.votacaoId, schema.voto.parlamentarId],
        set: {
          voto: dsql`excluded.voto`,
          votoOriginal: dsql`excluded.voto_original`,
          partidoNaHora: dsql`excluded.partido_na_hora`,
        },
      });

    await tx
      .insert(schema.evento)
      .values(
        linhasVoto.map((x) => ({
          parlamentarId: x.parlamentarId,
          tipo: "voto" as const,
          ocorridoEm: dataHora,
          refId: id,
          resumo: { voto: x.voto, votoOriginal: x.votoOriginal, rotulo },
        })),
      )
      .onConflictDoUpdate({
        target: [schema.evento.parlamentarId, schema.evento.tipo, schema.evento.refId],
        set: { ocorridoEm: dsql`excluded.ocorrido_em`, resumo: dsql`excluded.resumo` },
      });
  });

  r.votos += linhasVoto.length;
}

export async function sincronizarVotacoes(
  desde: string,
  ate: string,
  senadores: Map<string, SenadorInfo>,
): Promise<ResultadoVotacoes> {
  const r: ResultadoVotacoes = { votacoes: 0, nominais: 0, secretas: 0, votos: 0 };
  for (const [ini, fim] of janelas(desde, ate, 120)) {
    const lista = await buscarJson<VotacaoFonte[] | VotacaoFonte | null>(
      `${BASE}/votacao?dataInicio=${ini}&dataFim=${fim}`,
    );
    const votacoes = comoLista(lista)
      .filter((v) => (v.casaSessao ?? "SF") === "SF")
      // ordem cronológica e, dentro da sessão, a ordem em que foram votadas
      .sort(
        (a, b) =>
          a.dataSessao.localeCompare(b.dataSessao) ||
          (a.codigoSessao ?? 0) - (b.codigoSessao ?? 0) ||
          (a.sequencialSessao ?? 0) - (b.sequencialSessao ?? 0) ||
          a.codigoSessaoVotacao - b.codigoSessaoVotacao,
      );

    // busca os horários de sessão em paralelo (o http.ts limita a concorrência), grava em série
    const horas = await Promise.all(votacoes.map((v) => dataHoraVotacao(v)));
    for (const [i, v] of votacoes.entries()) {
      await gravarVotacao(v, horas[i]!, senadores, r);
      r.votacoes++;
      if (v.votacaoSecreta === "S") r.secretas++;
      else if (comoLista(v.votos).length > 0) r.nominais++;
    }
    log(`votações ${ini} → ${fim}: ${votacoes.length} (acumulado ${r.votacoes}, ${r.votos} votos)`);
  }
  return r;
}
