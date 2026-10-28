import { sql } from "@plenario/core/db";
import { baixar, bytesDoArquivo, etagRemoto, lerDados, type Arquivo } from "./arquivos";
import {
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
  urlProposicao,
} from "./comum";

// Escopo do card "proposição": o que o deputado apresenta como iniciativa própria (projetos,
// PEC, requerimento de informação a ministro, indicação ao Executivo). Fica de fora o que é
// peça de tramitação de proposição alheia: parecer de relator (PRL), emenda (EMC/EMP...),
// destaque (DTQ/RPD), requerimento procedimental (REQ: urgência, audiência, retirada de pauta),
// redação final etc. Essas existem às dezenas de milhares por ano e afogariam o feed.
export const TIPOS_AUTORIA = new Set(["PL", "PLP", "PEC", "PDL", "PRC", "RIC", "INC"]);

interface ProposicaoArquivo {
  id: number;
  siglaTipo: string;
  numero: number | null;
  ano: number | null;
  ementa: string | null;
  dataApresentacao: string | null;
}

interface AutorArquivo {
  idProposicao: number;
  idDeputadoAutor: number | null;
  codTipoAutor: number;
  ordemAssinatura: string | null;
  proponente: string | null;
}

const COD_TIPO_AUTOR_DEPUTADO = 10000;

export interface ResultadoProposicoes {
  ultimaData?: string;
  etags: Record<string, string>;
}

export async function ingerirProposicoes(
  p: Periodo,
  parlamentares: Set<string>,
  cursor: EstadoCursor | null,
): Promise<ResultadoProposicoes> {
  const etags: Record<string, string> = { ...(cursor?.etags ?? {}) };
  let ultimaData = cursor?.ultimaData;

  for (const ano of anosEntre(p.desde, p.ate)) {
    const inicio = Date.now();
    const urlProps = `${ARQUIVOS}/proposicoes/json/proposicoes-${ano}.json`;
    const urlAutores = `${ARQUIVOS}/proposicoesAutores/json/proposicoesAutores-${ano}.json`;
    const chave = `${ano}`;
    if (p.incremental && etags[chave] === `${await etagRemoto(urlProps)}|${await etagRemoto(urlAutores)}`) {
      log(`proposições ${ano}: arquivos não mudaram desde a última carga, pulando`);
      continue;
    }
    const props = await baixar(urlProps);
    const autores = await baixar(urlAutores);
    if (!props || !autores) {
      log(`proposições ${ano}: arquivo ainda não publicado, pulando`);
      continue;
    }
    const assinatura = `${props.etag}|${autores.etag}`;
    const r = await processarAno(ano, props, autores, p, parlamentares);
    if (r.ultimaData && (!ultimaData || r.ultimaData > ultimaData)) ultimaData = r.ultimaData;
    etags[chave] = assinatura;
    log(
      `proposições ${ano}: ${fmt(r.proposicoes)} proposições, ${fmt(r.autorias)} autorias de deputados ` +
        `(${fmt(r.autoresIgnorados)} autorias de deputado fora da legislatura ignoradas) ` +
        `em ${((Date.now() - inicio) / 1000).toFixed(0)}s`,
    );
  }
  return { ultimaData, etags };
}

async function processarAno(
  ano: number,
  arqProps: Arquivo,
  arqAutores: Arquivo,
  p: Periodo,
  parlamentares: Set<string>,
) {
  // 1) proposições do escopo apresentadas no período
  const props = new Map<number, { linha: Record<string, unknown>; ocorridoEm: string }>();
  let ultimaData: string | undefined;
  for await (const x of lerDados<ProposicaoArquivo>(bytesDoArquivo(arqProps.caminho))) {
    if (!TIPOS_AUTORIA.has(x.siglaTipo) || !dentro(x.dataApresentacao, p)) continue;
    const ocorridoEm = horaBrasilia(x.dataApresentacao)!;
    props.set(x.id, {
      ocorridoEm,
      linha: {
        id: idCamara(x.id),
        casa: CASA,
        id_externo: String(x.id),
        sigla_tipo: x.siglaTipo,
        numero: x.numero || null,
        ano: x.ano || null,
        ementa: limparTexto(x.ementa),
        data_apresentacao: ocorridoEm,
        url: urlProposicao(x.id),
      },
    });
    const dia = x.dataApresentacao!.slice(0, 10);
    if (!ultimaData || dia > ultimaData) ultimaData = dia;
  }

  // 2) autorias de deputados nessas proposições (a fonte repete o par às vezes: fica a menor ordem)
  const autorias = new Map<string, { proposicao_id: string; parlamentar_id: string; ordem: number | null; proponente: boolean }>();
  let autoresIgnorados = 0;
  for await (const a of lerDados<AutorArquivo>(bytesDoArquivo(arqAutores.caminho))) {
    if (a.codTipoAutor !== COD_TIPO_AUTOR_DEPUTADO || !a.idDeputadoAutor || !props.has(a.idProposicao)) continue;
    const parlamentarId = idCamara(a.idDeputadoAutor);
    if (!parlamentares.has(parlamentarId)) {
      autoresIgnorados++;
      continue;
    }
    const proposicaoId = idCamara(a.idProposicao);
    const ordem = a.ordemAssinatura ? Number(a.ordemAssinatura) || null : null;
    const chave = `${proposicaoId}|${parlamentarId}`;
    const ant = autorias.get(chave);
    autorias.set(chave, {
      proposicao_id: proposicaoId,
      parlamentar_id: parlamentarId,
      ordem: ant?.ordem != null && (ordem == null || ant.ordem < ordem) ? ant.ordem : ordem,
      proponente: (ant?.proponente ?? false) || a.proponente === "1",
    });
  }

  // só grava proposição que tem pelo menos um deputado da legislatura como autor
  const comAutor = new Set([...autorias.values()].map((a) => a.proposicao_id));
  const linhas = [...props.values()].filter((x) => comAutor.has(x.linha.id as string));
  const ocorrido = new Map(linhas.map((x) => [x.linha.id as string, x.ocorridoEm]));

  await emLotes(linhas.map((x) => x.linha), 1000, (lote) => sql`
    insert into proposicao ${sql(lote as never)}
    on conflict (id) do update set
      sigla_tipo = excluded.sigla_tipo, numero = excluded.numero, ano = excluded.ano,
      ementa = excluded.ementa, data_apresentacao = excluded.data_apresentacao,
      url = excluded.url, atualizado_em = now()`);

  const listaAutorias = [...autorias.values()];
  await emLotes(listaAutorias, 2000, (lote) => sql`
    insert into proposicao_autor ${sql(lote)}
    on conflict (proposicao_id, parlamentar_id) do update set
      ordem = excluded.ordem, proponente = excluded.proponente`);

  const eventos = listaAutorias.map((a) => ({
    parlamentar_id: a.parlamentar_id,
    tipo: "proposicao",
    ocorrido_em: ocorrido.get(a.proposicao_id)!,
    ref_id: a.proposicao_id,
  }));
  await emLotes(eventos, 2000, (lote) => sql`
    insert into evento ${sql(lote)}
    on conflict (parlamentar_id, tipo, ref_id) do update set ocorrido_em = excluded.ocorrido_em
    where evento.ocorrido_em is distinct from excluded.ocorrido_em`);

  return { proposicoes: linhas.length, autorias: listaAutorias.length, autoresIgnorados, ultimaData };
}
