import { sql } from "@plenario/core/db";
import { buscarJson } from "../http";
import { baixar, bytesDoArquivo, etagRemoto, lerDados } from "./arquivos";
import {
  API,
  ARQUIVOS,
  CASA,
  type EstadoCursor,
  type Periodo,
  anosEntre,
  dentro,
  emLotes,
  fmt,
  horaBrasilia,
  limparTexto,
  idCamara,
  log,
  somarDias,
  urlProposicao,
} from "./comum";

type VotoTipo = "sim" | "nao" | "abstencao" | "obstrucao" | "art17" | "ausente" | "outro";

export function normalizarVoto(cru: string): VotoTipo {
  const v = cru
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
  if (v === "sim") return "sim";
  if (v === "nao") return "nao";
  if (v === "abstencao") return "abstencao";
  if (v === "obstrucao") return "obstrucao";
  if (v === "artigo 17" || v === "art. 17" || v === "art 17") return "art17";
  if (v === "ausente" || v === "ausencia") return "ausente";
  return "outro";
}

interface PropRef {
  id: number;
  siglaTipo: string;
  numero: number | null;
  ano: number | null;
  ementa: string | null;
  dataApresentacao?: string | null;
}

interface VotoBruto {
  deputado: number;
  voto: string;
  partido: string | null;
}

interface VotacaoNormalizada {
  idExterno: string;
  dataHora: string; // naive Brasília
  idEvento: number | null;
  orgao: string | null;
  descricao: string | null;
  aprovacao: number | null;
  placar: { sim: number; nao: number; outros: number } | null; // null = fonte não deu
  proposicoes: PropRef[];
  votos: VotoBruto[];
}

// Página pública da sessão/reunião onde a votação ocorreu (pauta, resultado, vídeo). A Câmara
// não tem página HTML por votação; a do evento abre em 200 para id real e 500 para id
// inexistente (conferido com curl). Toda votação nominal da legislatura tem `idEvento`; ~15% das
// simbólicas (despacho de encaminhamento, por ex.) vêm com 0 e ficam sem link.
const urlEvento = (idEvento: number | null | undefined) =>
  idEvento && idEvento > 0 ? `https://www.camara.leg.br/evento-legislativo/${idEvento}` : null;

// Uma votação pode afetar mais de uma proposição (ex.: recurso REC + o PL que ele destrava).
// Pro card, a proposição "principal" é a de maior hierarquia legislativa; empate fica com a
// que dá nome à votação (o id da votação é "<idProposicao>-<sequência>").
const PRIORIDADE_TIPO = ["PEC", "PLP", "PL", "MPV", "PLV", "PDL", "PRC", "PLN"];

function proposicaoPrincipal(v: VotacaoNormalizada): PropRef | undefined {
  const prefixo = Number(v.idExterno.split("-")[0]);
  const peso = (p: PropRef) => {
    const i = PRIORIDADE_TIPO.indexOf(p.siglaTipo);
    return (i < 0 ? 100 : i) * 2 + (p.id === prefixo ? 0 : 1);
  };
  return [...v.proposicoes].sort((a, b) => peso(a) - peso(b))[0];
}

interface Totais {
  votacoes: number;
  nominais: number;
  secretas: number;
  votos: number;
  votosIgnorados: number;
  placarSemVotos: number;
  placarDivergente: number;
  valoresDesconhecidos: Map<string, number>;
}

const novosTotais = (): Totais => ({
  votacoes: 0,
  nominais: 0,
  secretas: 0,
  votos: 0,
  votosIgnorados: 0,
  placarSemVotos: 0,
  placarDivergente: 0,
  valoresDesconhecidos: new Map(),
});

async function gravar(lista: VotacaoNormalizada[], parlamentares: Set<string>, t: Totais) {
  const propsNovas = new Map<string, Record<string, unknown>>();
  const votacoes: Record<string, unknown>[] = [];
  const votos: Record<string, unknown>[] = [];
  const eventos: Record<string, unknown>[] = [];

  for (const v of lista) {
    const id = idCamara(v.idExterno);
    const dataHora = horaBrasilia(v.dataHora)!;
    const prop = proposicaoPrincipal(v);
    if (prop) {
      propsNovas.set(idCamara(prop.id), {
        id: idCamara(prop.id),
        casa: CASA,
        id_externo: String(prop.id),
        sigla_tipo: prop.siglaTipo,
        numero: prop.numero || null,
        ano: prop.ano || null,
        ementa: limparTexto(prop.ementa),
        data_apresentacao: horaBrasilia(prop.dataApresentacao),
        url: urlProposicao(prop.id),
      });
    }

    // Votação secreta (ex.: indicação de ministro do TCU) vem com uma linha por deputado e o
    // voto em branco: registra presença, não voto. Não é nominal pro produto.
    const comVoto = v.votos.filter((x) => x.voto.trim() !== "");
    const secreta = v.votos.length > 0 && comVoto.length === 0;
    if (secreta) t.secretas++;
    const nominal = comVoto.length > 0;

    const contagem = { sim: 0, nao: 0, outros: 0 };
    const vistos = new Set<string>();
    for (const x of comVoto) {
      const tipo = normalizarVoto(x.voto);
      if (tipo === "outro") t.valoresDesconhecidos.set(x.voto, (t.valoresDesconhecidos.get(x.voto) ?? 0) + 1);
      if (tipo === "sim") contagem.sim++;
      else if (tipo === "nao") contagem.nao++;
      else contagem.outros++;
      const parlamentarId = idCamara(x.deputado);
      if (!parlamentares.has(parlamentarId) || vistos.has(parlamentarId)) {
        t.votosIgnorados++;
        continue;
      }
      vistos.add(parlamentarId);
      votos.push({
        votacao_id: id,
        parlamentar_id: parlamentarId,
        voto: tipo,
        voto_original: x.voto,
        partido_na_hora: x.partido || null,
      });
      eventos.push({ parlamentar_id: parlamentarId, tipo: "voto", ocorrido_em: dataHora, ref_id: id });
    }

    const fonteDeuPlacar = !!v.placar && v.placar.sim + v.placar.nao + v.placar.outros > 0;
    if (fonteDeuPlacar && !nominal && v.votos.length === 0) t.placarSemVotos++;
    if (
      fonteDeuPlacar &&
      nominal &&
      (v.placar!.sim !== contagem.sim || v.placar!.nao !== contagem.nao || v.placar!.outros !== contagem.outros)
    ) {
      t.placarDivergente++;
    }
    const placar = fonteDeuPlacar ? v.placar! : nominal ? contagem : null;

    votacoes.push({
      id,
      casa: CASA,
      id_externo: v.idExterno,
      data_hora: dataHora,
      data_hora_aproximada: false, // a Câmara dá a hora do registro da votação
      orgao: v.orgao || null,
      descricao: limparTexto(v.descricao),
      proposicao_id: prop ? idCamara(prop.id) : null,
      aprovada: v.aprovacao == null ? null : v.aprovacao === 1,
      nominal,
      secreta,
      url: urlEvento(v.idEvento),
      placar_sim: placar?.sim ?? null,
      placar_nao: placar?.nao ?? null,
      placar_outros: placar?.outros ?? null,
    });
    t.votacoes++;
    if (nominal) t.nominais++;
  }
  t.votos += votos.length;

  // proposição que só conhecemos pela votação: cria com o que tem, sem sobrescrever a carga
  // de proposições (que tem data de apresentação e é a fonte melhor)
  await emLotes([...propsNovas.values()], 1000, (lote) => sql`
    insert into proposicao ${sql(lote as never)}
    on conflict (id) do update set
      data_apresentacao = coalesce(proposicao.data_apresentacao, excluded.data_apresentacao),
      ementa = coalesce(proposicao.ementa, excluded.ementa)`);
  await emLotes(votacoes, 1000, (lote) => sql`
    insert into votacao ${sql(lote as never)}
    on conflict (id) do update set
      data_hora = excluded.data_hora, orgao = excluded.orgao, descricao = excluded.descricao,
      proposicao_id = excluded.proposicao_id, aprovada = excluded.aprovada, nominal = excluded.nominal,
      secreta = excluded.secreta, url = excluded.url, data_hora_aproximada = excluded.data_hora_aproximada,
      placar_sim = excluded.placar_sim, placar_nao = excluded.placar_nao,
      placar_outros = excluded.placar_outros, atualizado_em = now()`);
  await emLotes(votos, 2000, (lote) => sql`
    insert into voto ${sql(lote as never)}
    on conflict (votacao_id, parlamentar_id) do update set
      voto = excluded.voto, voto_original = excluded.voto_original, partido_na_hora = excluded.partido_na_hora
    where (voto.voto, voto.voto_original, voto.partido_na_hora)
      is distinct from (excluded.voto, excluded.voto_original, excluded.partido_na_hora)`);
  await emLotes(eventos, 2000, (lote) => sql`
    insert into evento ${sql(lote as never)}
    on conflict (parlamentar_id, tipo, ref_id) do update set ocorrido_em = excluded.ocorrido_em
    where evento.ocorrido_em is distinct from excluded.ocorrido_em`);
}

function resumo(t: Totais): string {
  const partes = [
    `${fmt(t.votacoes)} votações (${fmt(t.nominais)} nominais)`,
    `${fmt(t.votos)} votos`,
  ];
  if (t.secretas) partes.push(`${fmt(t.secretas)} secretas sem voto individual`);
  if (t.votosIgnorados) partes.push(`${fmt(t.votosIgnorados)} votos de deputado desconhecido/repetido ignorados`);
  if (t.placarSemVotos) partes.push(`${fmt(t.placarSemVotos)} com placar mas sem votos no arquivo`);
  if (t.placarDivergente) partes.push(`${fmt(t.placarDivergente)} com placar da fonte != soma dos votos`);
  if (t.valoresDesconhecidos.size) {
    partes.push(`votos "outro": ${[...t.valoresDesconhecidos].map(([k, n]) => `${JSON.stringify(k)}=${n}`).join(", ")}`);
  }
  return partes.join(", ");
}

// ---------------- arquivos em lote ----------------

interface VotacaoArquivo {
  id: string;
  data: string;
  dataHoraRegistro: string | null;
  idEvento: number | null;
  siglaOrgao: string | null;
  aprovacao: number | null;
  votosSim: number | null;
  votosNao: number | null;
  votosOutros: number | null;
  descricao: string | null;
}
interface VotoArquivo {
  idVotacao: string;
  voto: string | null;
  deputado_: { id: string | number; siglaPartido: string | null };
}
interface VotacaoPropArquivo {
  idVotacao: string;
  proposicao_: PropRef;
}

export interface ResultadoVotacoes {
  ultimaData?: string;
  ultimaDataArquivo?: string;
  etags: Record<string, string>;
}

export async function ingerirVotacoes(
  p: Periodo,
  parlamentares: Set<string>,
  cursor: EstadoCursor | null,
): Promise<ResultadoVotacoes> {
  const etags: Record<string, string> = { ...(cursor?.etags ?? {}) };
  let ultimaData = cursor?.ultimaData;
  let ultimaDataArquivo = cursor?.ultimaDataArquivo as string | undefined;
  const maior = (a: string | undefined, b: string | undefined) => (!a ? b : !b ? a : a > b ? a : b);

  for (const ano of anosEntre(p.desde, p.ate)) {
    const inicio = Date.now();
    const base = (c: string) => `${ARQUIVOS}/${c}/json/${c}-${ano}.json`;
    const conjuntos = ["votacoes", "votacoesVotos", "votacoesProposicoes"];
    if (p.incremental) {
      const remotos = await Promise.all(conjuntos.map((c) => etagRemoto(base(c))));
      if (etags[`${ano}`] === remotos.map((e) => e ?? "-").join("|")) {
        log(`votações ${ano}: arquivos não mudaram desde a última carga, pulando`);
        continue;
      }
    }
    const arqVotacoes = await baixar(base("votacoes"));
    if (!arqVotacoes) {
      log(`votações ${ano}: arquivo ainda não publicado, pulando`);
      continue;
    }
    const arqVotos = await baixar(base("votacoesVotos"));
    const arqProps = await baixar(base("votacoesProposicoes"));
    const assinatura = [arqVotacoes, arqVotos, arqProps].map((a) => a?.etag ?? "-").join("|");

    const mapa = new Map<string, VotacaoNormalizada>();
    let maxArquivo: string | undefined;
    for await (const v of lerDados<VotacaoArquivo>(bytesDoArquivo(arqVotacoes.caminho))) {
      maxArquivo = maior(maxArquivo, v.data);
      if (!dentro(v.data, p)) continue;
      mapa.set(v.id, {
        idExterno: v.id,
        dataHora: v.dataHoraRegistro || v.data,
        idEvento: v.idEvento,
        orgao: v.siglaOrgao,
        descricao: v.descricao,
        aprovacao: v.aprovacao,
        placar: { sim: v.votosSim ?? 0, nao: v.votosNao ?? 0, outros: v.votosOutros ?? 0 },
        proposicoes: [],
        votos: [],
      });
    }
    if (arqProps) {
      for await (const x of lerDados<VotacaoPropArquivo>(bytesDoArquivo(arqProps.caminho))) {
        const v = mapa.get(x.idVotacao);
        if (v && x.proposicao_?.id && !v.proposicoes.some((p2) => p2.id === x.proposicao_.id)) {
          v.proposicoes.push(x.proposicao_);
        }
      }
    }
    if (arqVotos) {
      for await (const x of lerDados<VotoArquivo>(bytesDoArquivo(arqVotos.caminho))) {
        const v = mapa.get(x.idVotacao);
        if (v) v.votos.push({ deputado: Number(x.deputado_.id), voto: x.voto ?? "", partido: x.deputado_.siglaPartido });
      }
    }

    const t = novosTotais();
    const lista = [...mapa.values()];
    // em blocos, pra não montar 200 mil linhas de voto de uma vez
    await emLotes(lista, 500, (lote) => gravar(lote, parlamentares, t));
    for (const v of lista) ultimaData = maior(ultimaData, v.dataHora.slice(0, 10));
    ultimaDataArquivo = maior(ultimaDataArquivo, maxArquivo);
    etags[`${ano}`] = assinatura;
    log(`votações ${ano}: ${resumo(t)} em ${((Date.now() - inicio) / 1000).toFixed(0)}s`);
  }

  // ---- cauda pela API: o que é mais novo que o arquivo do dia ----
  const desdeApi = ultimaDataArquivo ? somarDias(ultimaDataArquivo, 1) : p.desde;
  const inicioApi = desdeApi > p.desde ? desdeApi : p.desde;
  if (inicioApi <= p.ate) {
    const t = novosTotais();
    const lista = await votacoesDaApi(inicioApi, p.ate);
    await emLotes(lista, 500, (lote) => gravar(lote, parlamentares, t));
    for (const v of lista) ultimaData = maior(ultimaData, v.dataHora.slice(0, 10));
    log(`votações via API (${inicioApi} a ${p.ate}, mais novas que o arquivo): ${resumo(t)}`);
  }

  return { ultimaData, ultimaDataArquivo, etags };
}

// ---------------- API (incremental) ----------------

interface VotacaoApiLista {
  id: string;
  data: string;
  dataHoraRegistro: string | null;
  siglaOrgao: string | null;
  descricao: string | null;
  aprovacao: number | null;
}
interface VotacaoApiDetalhe extends VotacaoApiLista {
  idEvento: number | null;
  proposicoesAfetadas: PropRef[] | null;
}
interface VotoApi {
  tipoVoto: string | null;
  deputado_: { id: number; siglaPartido: string | null };
}
type Pagina<T> = { dados: T[]; links: { rel: string; href: string }[] };

async function votacoesDaApi(desde: string, ate: string): Promise<VotacaoNormalizada[]> {
  const lista: VotacaoApiLista[] = [];
  // a API recusa intervalo que atravessa o ano
  for (const ano of anosEntre(desde, ate)) {
    const ini = `${ano}` === desde.slice(0, 4) ? desde : `${ano}-01-01`;
    const fim = `${ano}` === ate.slice(0, 4) ? ate : `${ano}-12-31`;
    let url: string | undefined =
      `${API}/votacoes?dataInicio=${ini}&dataFim=${fim}&itens=100&ordem=ASC&ordenarPor=dataHoraRegistro`;
    while (url) {
      const r: Pagina<VotacaoApiLista> = await buscarJson(url);
      lista.push(...r.dados);
      url = r.links.find((l) => l.rel === "next")?.href;
    }
  }
  return Promise.all(
    lista.map(async (v) => {
      const [det, votos] = await Promise.all([
        buscarJson<{ dados: VotacaoApiDetalhe }>(`${API}/votacoes/${v.id}`),
        buscarJson<{ dados: VotoApi[] }>(`${API}/votacoes/${v.id}/votos`),
      ]);
      return {
        idExterno: v.id,
        dataHora: det.dados.dataHoraRegistro || v.dataHoraRegistro || v.data,
        idEvento: det.dados.idEvento,
        orgao: det.dados.siglaOrgao ?? v.siglaOrgao,
        descricao: det.dados.descricao ?? v.descricao,
        aprovacao: det.dados.aprovacao ?? v.aprovacao,
        placar: null, // a API não dá placar: sai da soma dos votos
        proposicoes: det.dados.proposicoesAfetadas ?? [],
        votos: votos.dados.map((x) => ({
          deputado: x.deputado_.id,
          voto: x.tipoVoto ?? "",
          partido: x.deputado_.siglaPartido,
        })),
      };
    }),
  );
}
