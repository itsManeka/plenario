import { sql } from "@plenario/core/db";
import { normalizarBusca } from "@plenario/core/texto";
import { buscarJson } from "../http";
import { baixar, bytesDoArquivo, etagRemoto, lerDados } from "./arquivos";
import { API, ARQUIVOS, CASA, LEGISLATURA, emLotes, fmt, gravarCursor, idCamara, lerCursor, log } from "./comum";

interface DeputadoLista {
  id: number;
  nome: string;
  siglaPartido: string | null;
  siglaUf: string | null;
  urlFoto: string | null;
  email: string | null;
}

interface DeputadoArquivo {
  uri: string;
  nome: string;
  nomeCivil: string | null;
  idLegislaturaInicial: number;
  idLegislaturaFinal: number;
}

interface DeputadoDetalhe {
  id: number;
  nomeCivil: string | null;
  ultimoStatus: {
    nome: string;
    siglaPartido: string | null;
    siglaUf: string | null;
    urlFoto: string | null;
    email: string | null;
    gabinete?: { email: string | null } | null;
  };
}

async function listar(url: string): Promise<DeputadoLista[]> {
  const todos: DeputadoLista[] = [];
  let proxima: string | undefined = url;
  while (proxima) {
    const r: { dados: DeputadoLista[]; links: { rel: string; href: string }[] } = await buscarJson(proxima);
    todos.push(...r.dados);
    proxima = r.links.find((l) => l.rel === "next")?.href;
  }
  return todos;
}

/**
 * Todos os deputados que exerceram mandato na legislatura 57 (inclusive suplentes e quem saiu).
 *
 * - `/deputados?idLegislatura=57` traz uma linha por (deputado, partido) e sem ordem confiável,
 *   então serve só como lista de quem exerceu.
 * - `/deputados` (sem filtro) são os em exercício hoje, com partido/UF/e-mail atuais.
 * - Nome civil vem do arquivo `deputados.json` (um arquivo em vez de 648 chamadas).
 * - Para quem não está em exercício, o partido atual só vem do detalhe; buscamos o detalhe
 *   apenas de quem é novo no banco ou acabou de sair de exercício.
 */
export interface ResultadoDeputados {
  ids: number[];
  /** novos no banco ou que entraram/saíram de exercício nesta carga */
  mudaram: Set<number>;
}

export async function ingerirDeputados(): Promise<ResultadoDeputados> {
  const inicio = Date.now();
  // o arquivo só serve pro nome civil, que já fica no banco: não baixa de novo se não mudou
  const urlArquivo = `${ARQUIVOS}/deputados/json/deputados.json`;
  const etagArquivo = await etagRemoto(urlArquivo);
  const etagAnterior = (await lerCursor("camara:deputados"))?.etagArquivo;
  const [daLegislatura, emExercicio, arquivo] = await Promise.all([
    listar(`${API}/deputados?idLegislatura=${LEGISLATURA}&itens=1000&ordem=ASC&ordenarPor=nome`),
    listar(`${API}/deputados?itens=1000&ordem=ASC&ordenarPor=nome`),
    etagArquivo && etagArquivo === etagAnterior ? Promise.resolve(null) : baixar(urlArquivo),
  ]);

  const nomeCivil = new Map<number, string | null>();
  if (arquivo) {
    for await (const d of lerDados<DeputadoArquivo>(bytesDoArquivo(arquivo.caminho))) {
      if (d.idLegislaturaFinal < LEGISLATURA || d.idLegislaturaInicial > LEGISLATURA) continue;
      const id = Number(d.uri.split("/").pop());
      nomeCivil.set(id, d.nomeCivil || null);
    }
  }

  const atuais = new Map(emExercicio.map((d) => [d.id, d]));
  const legislatura = new Map<number, DeputadoLista>();
  for (const d of daLegislatura) legislatura.set(d.id, d);
  // quem está em exercício hoje é, por definição, da legislatura atual
  for (const d of emExercicio) legislatura.set(d.id, d);

  const noBanco = new Map(
    (
      await sql<{ id_externo: string; em_exercicio: boolean; partido: string | null; nome_civil: string | null }[]>`
        select id_externo, em_exercicio, partido, nome_civil from parlamentar where casa = 'camara'`
    ).map((l) => [Number(l.id_externo), l]),
  );

  const precisaDetalhe = [...legislatura.keys()].filter((id) => {
    if (atuais.has(id)) return !nomeCivil.get(id) && !noBanco.get(id)?.nome_civil;
    const banco = noBanco.get(id);
    return !banco || banco.em_exercicio || !banco.partido;
  });
  const detalhes = new Map<number, DeputadoDetalhe>();
  await Promise.all(
    precisaDetalhe.map(async (id) => {
      const r = await buscarJson<{ dados: DeputadoDetalhe }>(`${API}/deputados/${id}`);
      detalhes.set(id, r.dados);
    }),
  );

  const linhas = [...legislatura.values()].map((d) => {
    const atual = atuais.get(d.id);
    const det = detalhes.get(d.id);
    const banco = noBanco.get(d.id);
    const st = det?.ultimoStatus;
    const nome = atual?.nome ?? st?.nome ?? d.nome;
    const civil = nomeCivil.get(d.id) ?? det?.nomeCivil ?? banco?.nome_civil ?? null;
    return {
      id: idCamara(d.id),
      casa: CASA,
      id_externo: String(d.id),
      nome,
      nome_civil: civil,
      // sem detalhe novo, quem está fora de exercício mantém o partido já gravado
      partido: atual?.siglaPartido ?? st?.siglaPartido ?? banco?.partido ?? d.siglaPartido ?? null,
      uf: atual?.siglaUf ?? st?.siglaUf ?? d.siglaUf ?? null,
      foto_url: atual?.urlFoto ?? st?.urlFoto ?? d.urlFoto ?? null,
      email: atual?.email ?? st?.email ?? st?.gabinete?.email ?? d.email ?? null,
      em_exercicio: atuais.has(d.id),
      busca: normalizarBusca(nome, civil),
    };
  });

  await emLotes(linhas, 500, (lote) => sql`
    insert into parlamentar ${sql(lote)}
    on conflict (id) do update set
      nome = excluded.nome, nome_civil = excluded.nome_civil, partido = excluded.partido,
      uf = excluded.uf, foto_url = excluded.foto_url, email = excluded.email,
      em_exercicio = excluded.em_exercicio, busca = excluded.busca, atualizado_em = now()`);

  const mudaram = new Set(
    [...legislatura.keys()].filter((id) => noBanco.get(id)?.em_exercicio !== atuais.has(id)),
  );

  await gravarCursor("camara:deputados", {
    total: linhas.length,
    emExercicio: atuais.size,
    etagArquivo: arquivo?.etag ?? etagAnterior,
  });
  log(
    `deputados: ${fmt(linhas.length)} na legislatura ${LEGISLATURA} (${fmt(atuais.size)} em exercício, ` +
      `${fmt(detalhes.size)} detalhes buscados) em ${((Date.now() - inicio) / 1000).toFixed(0)}s`,
  );
  return { ids: [...legislatura.keys()], mudaram };
}
