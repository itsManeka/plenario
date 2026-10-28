import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { FeedItem, FeedItemVoto, Pagina, Parlamentar, ParlamentarResumo, ProposicaoDetalhe, VotacaoDetalhe } from "@plenario/core/api";

// db.ts lê DATABASE_URL na importação: troca pro banco de teste antes de importar o app.
// Os testes apagam as tabelas, então se recusam a rodar fora de um banco "*_test".
const URL_TESTE = process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/plenario_test";
if (!/_test(\?.*)?$/.test(URL_TESTE)) throw new Error(`banco de teste precisa terminar em _test: ${URL_TESTE}`);
process.env.DATABASE_URL = URL_TESTE;

const { app } = await import("./app");
const { sql } = await import("@plenario/core/db");
const { normalizarBusca } = await import("@plenario/core/texto");
const { urlCotaCamara } = await import("./util");

async function get<T>(path: string): Promise<{ status: number; body: T; res: Response }> {
  const res = await app.request(path);
  return { status: res.status, body: (await res.json()) as T, res };
}

const parlamentares = [
  // id, nome, nomeCivil, partido, uf
  ["camara:1", "João da Silva", "João Carlos da Silva", "PT", "SP"],
  ["camara:3", "Ângela Souza", null, "PT", "SP"],
  ["camara:6", "Zé Ninguém", null, "PT", "MG"],
  ["camara:2", "Maria Conceição", null, "PL", "RJ"],
  ["camara:4", "Pedro Álvares", null, "PSOL", "BA"],
  ["senado:10", "José Serra", "José Serra Chirico", "PSDB", "SP"],
] as const;

// Eventos de enchimento pra paginação: vários com o mesmo instante (desempate por id) e alguns
// separados por 1 µs (o cursor não pode truncar pra milissegundo).
const N_ENCHIMENTO = 70;

beforeAll(async () => {
  await sql`truncate evento, despesa, voto, votacao, exercicio, proposicao_autor, consulta_publica, proposicao, parlamentar restart identity cascade`;

  for (const [id, nome, civil, partido, uf] of parlamentares) {
    const [casa, ext] = id.split(":");
    await sql`insert into parlamentar (id, casa, id_externo, nome, nome_civil, partido, uf, busca)
      values (${id}, ${casa!}::casa, ${ext!}, ${nome}, ${civil}, ${partido}, ${uf}, ${normalizarBusca(nome, civil)})`;
  }

  await sql`insert into proposicao (id, casa, id_externo, sigla_tipo, numero, ano, ementa, url, data_apresentacao) values
    ('camara:p1', 'camara', 'p1', 'PL', 1234, 2026, 'Ementa do PL', 'https://www.camara.leg.br/propostas-legislativas/p1', '2026-09-01T12:00:00Z')`;
  await sql`insert into proposicao_autor (proposicao_id, parlamentar_id, ordem, proponente) values
    ('camara:p1', 'camara:1', 1, true), ('camara:p1', 'camara:3', 2, true)`;
  for (let i = 0; i < N_ENCHIMENTO; i++) {
    await sql`insert into proposicao (id, casa, id_externo, sigla_tipo, numero, ano) values (${"camara:f" + i}, 'camara', ${"f" + i}, 'REQ', ${i}, 2026)`;
    await sql`insert into proposicao_autor (proposicao_id, parlamentar_id, ordem) values (${"camara:f" + i}, 'camara:3', null)`;
  }

  // v1..v5 nominais; camara:1 vota em v1, v2, v3 (ausente), v5 (obstrução) e não aparece em v4
  const votacoes = [
    ["camara:v1", "2026-09-10T15:00:00Z", true],
    ["camara:v2", "2026-09-11T15:00:00Z", true],
    ["camara:v3", "2026-09-12T15:00:00Z", true],
    ["camara:v4", "2026-09-13T15:00:00Z", true],
    ["camara:v5", "2026-09-14T15:00:00Z", true],
    ["camara:v6", "2026-09-20T15:00:00Z", true], // fora da janela de camara:1
    ["camara:s1", "2026-09-12T16:00:00Z", false],
    ["camara:c1", "2026-09-12T17:00:00Z", true], // comissão: fora da conta de presença
    ["camara:v7", "2026-09-25T15:00:00Z", true], // sem proposição e sem url
    ["camara:v8", "2026-09-12T18:00:00Z", true], // secreta: fora da conta de presença
    ["camara:v9", "2026-09-11T02:30:00Z", true], // 10/09 23h30 em Brasília
  ] as const;
  for (const [id, quando, nominal] of votacoes) {
    await sql`insert into votacao (id, casa, id_externo, data_hora, orgao, descricao, proposicao_id, aprovada, nominal,
        secreta, url, placar_sim, placar_nao, placar_outros)
      values (${id}, 'camara', ${id.slice(7)}, ${quando}, ${id === "camara:c1" ? "CCJC" : "PLEN"}, ${"Votação " + id},
        ${id === "camara:v7" ? null : "camara:p1"}, true, ${nominal}, ${id === "camara:v8"},
        ${id === "camara:v1" ? "https://www.camara.leg.br/votacao/v1" : null}, 3, 1, 0)`;
  }
  // camara:3 de licença entre 11/09 e 13/09: dois períodos de exercício, o último em aberto
  await sql`insert into exercicio (parlamentar_id, inicio, fim, motivo_fim) values
    ('camara:3', '2026-09-01', '2026-09-10', 'Licença'), ('camara:3', '2026-09-14', null, null)`;
  const votos: [string, string, string, string | null][] = [
    // v1: PT sim, sim, nao -> maioria sim
    ["camara:v1", "camara:1", "sim", "PT"],
    ["camara:v1", "camara:3", "sim", "PT"],
    ["camara:v1", "camara:6", "nao", "PT"],
    ["camara:v1", "camara:4", "sim", "PSOL"], // único do partido -> null
    ["camara:v1", "camara:2", "nao", null], // sem partido -> null
    // v2: PT empata 1x1 -> null
    ["camara:v2", "camara:1", "nao", "PT"],
    ["camara:v2", "camara:3", "sim", "PT"],
    ["camara:v3", "camara:1", "ausente", "PT"],
    ["camara:v5", "camara:1", "obstrucao", "PT"],
    ["camara:v6", "camara:3", "sim", "PT"],
    ["camara:v7", "camara:3", "ausente", "PT"],
  ];
  for (const [votacaoId, parlId, v, partido] of votos) {
    await sql`insert into voto (votacao_id, parlamentar_id, voto, partido_na_hora) values (${votacaoId}, ${parlId}, ${v}::voto_tipo, ${partido})`;
  }

  const ano = Number(new Intl.DateTimeFormat("en", { timeZone: "America/Sao_Paulo", year: "numeric" }).format(new Date()));
  const despesas: [string, number, string, string][] = [
    ["d1", 9, "PASSAGEM AÉREA", "1000.10"],
    ["d2", 9, "PASSAGEM AÉREA", "500.00"],
    ["d3", 9, "COMBUSTÍVEL", "300.00"],
    ["d4", 9, "TELEFONIA", "50.00"],
    ["d5", 9, "DIVULGAÇÃO", "2000.00"],
    ["d6", 9, "HOSPEDAGEM", "400.00"],
    ["d7", 9, "ALIMENTAÇÃO", "10.00"],
  ];
  for (const [id, mes, cat, valor] of despesas) {
    await sql`insert into despesa (id, parlamentar_id, ano, mes, categoria, valor) values (${"camara:" + id}, 'camara:1', 2026, ${mes}, ${cat}, ${valor})`;
  }
  await sql`insert into despesa (id, parlamentar_id, ano, mes, categoria, valor) values ('camara:dano', 'camara:1', ${ano}, 1, 'X', '1.00')
    on conflict do nothing`;

  await sql`insert into evento (parlamentar_id, tipo, ocorrido_em, ref_id) values
    ('camara:1', 'voto', '2026-09-10T15:00:00Z', 'camara:v1'),
    ('camara:3', 'voto', '2026-09-10T15:00:00Z', 'camara:v1'),
    ('camara:6', 'voto', '2026-09-10T15:00:00Z', 'camara:v1'),
    ('camara:4', 'voto', '2026-09-10T15:00:00Z', 'camara:v1'),
    ('camara:2', 'voto', '2026-09-10T15:00:00Z', 'camara:v1'),
    ('camara:1', 'voto', '2026-09-11T15:00:00Z', 'camara:v2'),
    ('camara:1', 'voto', '2026-09-14T15:00:00Z', 'camara:v5'),
    ('camara:1', 'proposicao', '2026-09-01T12:00:00Z', 'camara:p1'),
    ('camara:3', 'proposicao', '2026-09-01T12:00:00Z', 'camara:p1'),
    ('camara:1', 'despesa_mensal', '2026-09-30T23:00:00Z', '2026-09'),
    ('camara:3', 'voto', '2026-09-25T15:00:00Z', 'camara:v7')`;
  for (let i = 0; i < N_ENCHIMENTO; i++) {
    // grupos de 10 no mesmo instante, e dentro de cada grupo metade separada por 1 µs
    const base = `2026-09-0${1 + Math.floor(i / 10)}T10:00:00.000`;
    const us = i % 2 === 0 ? "000" : "001";
    await sql`insert into evento (parlamentar_id, tipo, ocorrido_em, ref_id)
      values ('camara:3', 'proposicao', ${base + us + "Z"}::timestamptz, ${"camara:f" + i})`;
  }
});

afterAll(async () => {
  await sql.end();
});

async function idsEsperados(filtro = sql``): Promise<string[]> {
  const r = await sql<{ id: string }[]>`select id::text as id from evento e where true ${filtro} order by ocorrido_em desc, id desc`;
  return r.map((x) => x.id);
}

async function percorrer(path: string): Promise<{ ids: string[]; paginas: Pagina<FeedItem>[] }> {
  const ids: string[] = [];
  const paginas: Pagina<FeedItem>[] = [];
  let cursor: string | null = null;
  const sep = path.includes("?") ? "&" : "?";
  do {
    const url: string = cursor ? `${path}${sep}cursor=${cursor}` : path;
    const { status, body }: { status: number; body: Pagina<FeedItem> } = await get<Pagina<FeedItem>>(url);
    expect(status).toBe(200);
    paginas.push(body);
    ids.push(...body.itens.map((i) => i.id));
    cursor = body.proximo;
    if (paginas.length > 50) throw new Error("loop de paginação");
  } while (cursor);
  return { ids, paginas };
}

describe("health", () => {
  test("dadosAte = maior ocorrido_em", async () => {
    const { status, body, res } = await get<{ ok: boolean; dadosAte: string }>("/health");
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.dadosAte).toBe("2026-09-30T23:00:00.000Z");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("parlamentares", () => {
  test("busca sem acento acha nome acentuado", async () => {
    for (const q of ["joao", "JOÃO", "angela", "ângela", "alvares"]) {
      const { status, body } = await get<Pagina<ParlamentarResumo>>(`/parlamentares?q=${encodeURIComponent(q)}`);
      expect(status).toBe(200);
      expect(body.itens.length).toBeGreaterThan(0);
      expect(normalizarBusca(body.itens[0]!.nome)).toContain(normalizarBusca(q));
    }
  });

  test("busca tolera erro de digitação e acha por nome civil", async () => {
    const r1 = await get<Pagina<ParlamentarResumo>>("/parlamentares?q=conceicao");
    expect(r1.body.itens[0]?.id).toBe("camara:2");
    const r2 = await get<Pagina<ParlamentarResumo>>("/parlamentares?q=chirico");
    expect(r2.body.itens[0]?.id).toBe("senado:10");
    const r3 = await get<Pagina<ParlamentarResumo>>("/parlamentares?q=jose serrra");
    expect(r3.body.itens[0]?.id).toBe("senado:10");
  });

  test("filtros e paginação por nome", async () => {
    const pt = await get<Pagina<ParlamentarResumo>>("/parlamentares?partido=pt&uf=sp");
    expect(pt.body.itens.map((p) => p.id).sort()).toEqual(["camara:1", "camara:3"]);
    const sen = await get<Pagina<ParlamentarResumo>>("/parlamentares?casa=senado");
    expect(sen.body.itens.map((p) => p.id)).toEqual(["senado:10"]);

    const vistos: string[] = [];
    let cursor: string | null = null;
    do {
      const r: { body: Pagina<ParlamentarResumo> } = await get(`/parlamentares?limite=2${cursor ? `&cursor=${cursor}` : ""}`);
      vistos.push(...r.body.itens.map((p) => p.nome));
      cursor = r.body.proximo;
    } while (cursor);
    // ordem alfabética ignorando acento: Ângela antes de João
    expect(vistos).toEqual(["Ângela Souza", "João da Silva", "José Serra", "Maria Conceição", "Pedro Álvares", "Zé Ninguém"]);
  });

  test("detalhe com estatísticas e presença aproximada", async () => {
    const { status, body } = await get<Parlamentar>("/parlamentares/camara:1");
    expect(status).toBe(200);
    expect(body.urlOficial).toBe("https://www.camara.leg.br/deputados/1");
    expect(body.nomeCivil).toBe("João Carlos da Silva");
    // sem exercício: janela aproximada v1..v5 = v1, v9, v2, v3, v4, v5 (s1 simbólica, c1 comissão,
    // v8 secreta); presente em v1, v2, v5 (v3 ausente, v4 e v9 sem linha)
    expect(body.estatisticas.votacoesNominais).toBe(6);
    expect(body.estatisticas.presencaPct).toBe(50);
    expect(body.estatisticas.proposicoesAutor).toBe(1);
    expect(typeof body.estatisticas.despesasAnoCorrente).toBe("number");

    // com exercício interrompido por licença: períodos 01–10/09 e 14/09–hoje pegam v1, v9 (23h30
    // de 10/09 em Brasília), v5, v6, v7; presente em v1 e v6 (v2 foi na licença, v7 ausente)
    const lic = await get<Parlamentar>("/parlamentares/camara:3");
    expect(lic.body.estatisticas.votacoesNominais).toBe(5);
    expect(lic.body.estatisticas.presencaPct).toBe(40);

    const sen = await get<Parlamentar>("/parlamentares/senado:10");
    expect(sen.body.urlOficial).toBe("https://www25.senado.leg.br/web/senadores/senador/-/perfil/10");
    expect(sen.body.estatisticas.presencaPct).toBeNull();
    expect(sen.body.estatisticas.despesasAnoCorrente).toBeNull();
  });
});

describe("parlamentares?ids=", () => {
  test("na ordem pedida, omite inexistente e ignora filtros", async () => {
    const { status, body } = await get<Pagina<ParlamentarResumo>>(
      "/parlamentares?ids=senado:10,camara:999,camara:1,senado:10&casa=camara&limite=1",
    );
    expect(status).toBe(200);
    expect(body.itens.map((p) => p.id)).toEqual(["senado:10", "camara:1"]);
    expect(body.proximo).toBeNull();
  });

  test("400 com mais de 200 ou id malformado", async () => {
    const muitos = Array.from({ length: 201 }, (_, i) => `camara:${i}`).join(",");
    expect((await app.request(`/parlamentares?ids=${muitos}`)).status).toBe(400);
    expect((await app.request("/parlamentares?ids=camara:1,xyz")).status).toBe(400);
  });
});

describe("feed", () => {
  test("urlFonte nunca nulo nos três tipos, com a fonte mais específica", async () => {
    const { paginas } = await percorrer("/feed");
    const itens = paginas.flatMap((p) => p.itens);
    expect(new Set(itens.map((i) => i.tipo))).toEqual(new Set(["voto", "proposicao", "despesa_mensal"] as const));
    for (const i of itens) expect(i.urlFonte).toStartWith("https://");

    const url = (pred: (i: FeedItem) => boolean) => itens.find(pred)?.urlFonte;
    const voto = (parl: string, v: string) => (i: FeedItem) => i.tipo === "voto" && i.parlamentar.id === parl && i.votacao.id === v;
    expect(url(voto("camara:1", "camara:v1"))).toBe("https://www.camara.leg.br/votacao/v1"); // url da votação
    expect(url(voto("camara:1", "camara:v2"))).toBe("https://www.camara.leg.br/propostas-legislativas/p1"); // da proposição
    expect(url(voto("camara:3", "camara:v7"))).toBe("https://www.camara.leg.br/deputados/3"); // perfil
    const prop = (id: string) => (i: FeedItem) => i.tipo === "proposicao" && i.proposicao.id === id;
    expect(url(prop("camara:p1"))).toBe("https://www.camara.leg.br/propostas-legislativas/p1");
    expect(url(prop("camara:f0"))).toBe("https://www.camara.leg.br/deputados/3");
    expect(url((i) => i.tipo === "despesa_mensal")).toBe(
      "https://www.camara.leg.br/cota-parlamentar/consulta-cota-parlamentar?ideDeputado=1&dataInicio=092026&dataFim=092026",
    );
  });

  test("URL da cota usa mês com dois dígitos", () => {
    expect(urlCotaCamara("1", 2027, 1)).toContain("dataInicio=012027&dataFim=012027");
  });

  test("feed geral pagina sem pular nem duplicar", async () => {
    const esperado = await idsEsperados();
    expect(esperado.length).toBe(11 + N_ENCHIMENTO);
    const { ids, paginas } = await percorrer("/feed");
    expect(ids).toEqual(esperado);
    expect(new Set(ids).size).toBe(ids.length);
    expect(paginas[0]!.itens.length).toBe(30);
    expect(paginas.at(-1)!.proximo).toBeNull();
  });

  test("feed por parlamentares pagina sem pular nem duplicar", async () => {
    const esperado = await idsEsperados(sql`and parlamentar_id in ('camara:1', 'camara:3')`);
    const { ids } = await percorrer("/feed?parlamentares=camara:1,camara:3");
    expect(ids).toEqual(esperado);
    const proprio = await percorrer("/parlamentares/camara:3/feed");
    expect(proprio.ids).toEqual(await idsEsperados(sql`and parlamentar_id = 'camara:3'`));
  });

  test("evento consulta_publica nao vira card nem despesa_mensal", async () => {
    // ref_id no formato AAAA-MM: o ramo else antigo (despesa) aceitaria esse valor
    const [ins] = await sql<{ id: string }[]>`insert into evento (parlamentar_id, tipo, ocorrido_em, ref_id)
      values ('camara:1', 'consulta_publica', '2026-09-30T12:00:00Z', '2026-09')
      returning id::text as id`;
    try {
      const { ids, paginas } = await percorrer("/feed");
      expect(ids).not.toContain(ins!.id);
      expect(new Set(paginas.flatMap((p) => p.itens.map((i) => i.tipo)))).toEqual(
        new Set(["voto", "proposicao", "despesa_mensal"] as const),
      );
    } finally {
      await sql`delete from evento where id = ${ins!.id}::bigint`;
    }
  });

  test("filtro por tipos", async () => {
    const { ids, paginas } = await percorrer("/feed?tipos=voto,despesa_mensal");
    expect(ids).toEqual(await idsEsperados(sql`and tipo in ('voto', 'despesa_mensal')`));
    for (const p of paginas) for (const i of p.itens) expect(["voto", "despesa_mensal"]).toContain(i.tipo);

    const d = await get<Pagina<FeedItem>>("/parlamentares/camara:1/feed?tipos=despesa_mensal");
    expect(d.body.itens.length).toBe(1);
    const item = d.body.itens[0]!;
    if (item.tipo !== "despesa_mensal") throw new Error("tipo errado");
    expect(item.ano).toBe(2026);
    expect(item.mes).toBe(9);
    expect(item.total).toBe(4260.1);
    expect(item.porCategoria.length).toBe(5);
    expect(item.porCategoria[0]).toEqual({ categoria: "DIVULGAÇÃO", valor: 2000 });
    expect(item.porCategoria[1]).toEqual({ categoria: "PASSAGEM AÉREA", valor: 1500.1 });
  });

  test("comOPartido", async () => {
    const { body } = await get<Pagina<FeedItem>>("/feed?tipos=voto");
    const por = (parl: string, votacao: string) =>
      body.itens.find((i): i is FeedItemVoto => i.tipo === "voto" && i.parlamentar.id === parl && i.votacao.id === votacao);
    expect(por("camara:1", "camara:v1")?.comOPartido).toBe(true);
    expect(por("camara:6", "camara:v1")?.comOPartido).toBe(false);
    expect(por("camara:4", "camara:v1")?.comOPartido).toBeNull(); // partido de um só
    expect(por("camara:2", "camara:v1")?.comOPartido).toBeNull(); // sem partido
    expect(por("camara:1", "camara:v2")?.comOPartido).toBeNull(); // empate
    expect(por("camara:1", "camara:v5")?.comOPartido).toBeNull(); // obstrução
    const v1 = por("camara:1", "camara:v1")!;
    expect(v1.voto).toBe("sim");
    expect(v1.votacao.proposicao?.rotulo).toBe("PL 1234/2026");
    expect(v1.votacao.placar).toEqual({ sim: 3, nao: 1, outros: 0 });
  });

  test("papel autor/coautor", async () => {
    const { paginas } = await percorrer("/feed?tipos=proposicao&parlamentares=camara:1,camara:3");
    const body = { itens: paginas.flatMap((p) => p.itens) };
    const p1 = body.itens.filter((i) => i.tipo === "proposicao" && i.proposicao.id === "camara:p1");
    const papel = Object.fromEntries(p1.map((i) => [i.parlamentar.id, i.tipo === "proposicao" ? i.papel : null]));
    expect(papel).toEqual({ "camara:1": "autor", "camara:3": "coautor" });
    // autor único sem ordem na fonte conta como autor
    const f = body.itens.find((i) => i.tipo === "proposicao" && i.proposicao.id === "camara:f0");
    expect(f && f.tipo === "proposicao" ? f.papel : null).toBe("autor");
  });
});

describe("detalhes", () => {
  test("votação", async () => {
    const { status, body } = await get<VotacaoDetalhe>("/votacoes/camara:v1");
    expect(status).toBe(200);
    expect(body.votos.length).toBe(5);
    expect(body.porPartido.find((p) => p.partido === "PT")).toEqual({ partido: "PT", sim: 2, nao: 1, outros: 0 });
    expect(body.urlOficial).toBe("https://www.camara.leg.br/votacao/v1");
    expect(body.secreta).toBe(false);
    expect(body.dataHoraAproximada).toBe(false);
    const v2 = await get<VotacaoDetalhe>("/votacoes/camara:v2");
    expect(v2.body.urlOficial).toBeNull();
    const v8 = await get<VotacaoDetalhe>("/votacoes/camara:v8");
    expect(v8.body.secreta).toBe(true);
  });

  test("proposição", async () => {
    const { status, body } = await get<ProposicaoDetalhe>("/proposicoes/camara:p1");
    expect(status).toBe(200);
    expect(body.rotulo).toBe("PL 1234/2026");
    expect(body.autores.map((a) => a.parlamentar.id)).toEqual(["camara:1", "camara:3"]);
    expect(body.votacoes[0]?.id).toBe("camara:v6"); // mais recente primeiro
    expect(body.dataApresentacao).toBe("2026-09-01T12:00:00.000Z");
  });

  test("partidos", async () => {
    const { body, res } = await get<{ sigla: string; total: number }[]>("/partidos");
    expect(body[0]).toEqual({ sigla: "PT", total: 3 });
    expect(res.headers.get("cache-control")).toContain("max-age=60");
  });
});

describe("erros", () => {
  test("404 para ids inexistentes", async () => {
    for (const p of ["/parlamentares/camara:999", "/parlamentares/camara:999/feed", "/votacoes/camara:nada", "/proposicoes/senado:0", "/nao-existe"]) {
      const { status, body, res } = await get<{ erro: string }>(p);
      expect(status).toBe(404);
      expect(typeof body.erro).toBe("string");
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  test("400 para parâmetros inválidos", async () => {
    const muitos = Array.from({ length: 201 }, (_, i) => `camara:${i}`).join(",");
    for (const p of [
      "/parlamentares/xyz",
      "/parlamentares?casa=assembleia",
      "/parlamentares?limite=0",
      "/parlamentares?limite=101",
      "/parlamentares?uf=S",
      "/parlamentares?cursor=!!",
      "/feed?tipos=voto,discurso",
      "/feed?cursor=bGl4bw",
      `/feed?parlamentares=${muitos}`,
      "/feed?parlamentares=camara:1,drop%20table",
      "/parlamentares/camara:1/feed?cursor=xx",
    ]) {
      const { status, body } = await get<{ erro: string }>(p);
      expect({ p, status }).toEqual({ p, status: 400 });
      expect(typeof body.erro).toBe("string");
    }
    const ok = await get<Pagina<FeedItem>>(`/feed?parlamentares=${Array.from({ length: 200 }, (_, i) => `camara:${i}`).join(",")}`);
    expect(ok.status).toBe(200);
  });
});
