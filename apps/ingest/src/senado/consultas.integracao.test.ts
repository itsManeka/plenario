// Integracao do sync de consultas publicas contra o Postgres de teste (banco terminado em _test).
// `buscarTexto` e simulado via globalThis.fetch (fixtures de __fixtures__/); o modulo de producao so e
// importado depois da guarda do banco (`@plenario/core/db` le DATABASE_URL na importacao).
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { limparTabelas, prepararBancoDeTeste, type Sql } from "../testing/banco";
import { urlConsulta } from "./consulta_parser";

process.env.INGEST_CONSULTAS_INTERVALO_MS = "0";
delete process.env.INGEST_CONSULTAS_MAX;

const fixture = (nome: string): Promise<string> => Bun.file(new URL(`./__fixtures__/${nome}`, import.meta.url)).text();

const FETCH_ORIGINAL = globalThis.fetch;
const CONSOLE_LOG_ORIGINAL = console.log;

let sql: Sql;
let sincronizarConsultas: typeof import("./consultas").sincronizarConsultas;
let base: string;
let statusRedirecao: number;
let logs: string[];
let chamadas: string[];

interface OpcoesHtml {
  sim?: number;
  nao?: number;
  apuracao?: string;
}

// Parte da fixture real p160575 trocando materiaId, placar e data da apuracao (dd/mm/aaaa hh:mm:ss, -03:00).
function htmlConsulta(cod: string, o: OpcoesHtml = {}): string {
  const { sim = 100, nao = 50, apuracao = "28/10/2026 10:18:46" } = o;
  return base
    .replace('value="160575"', `value="${cod}"`)
    .replace(">721.508</span>", `>${sim}</span>`)
    .replace(">1.142.443</span>", `>${nao}</span>`)
    .replace("Votos apurados até 28/10/2026 10:18:46", `Votos apurados até ${apuracao}`);
}

type Mapa = Record<string, () => Response>;

function simularFetch(porCod: Record<string, () => Response>): void {
  const mapa: Mapa = {};
  for (const [cod, h] of Object.entries(porCod)) mapa[urlConsulta(Number(cod))] = h;
  const falso = async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    chamadas.push(url);
    const h = mapa[url];
    return h ? h() : new Response("sem mock", { status: 404 });
  };
  globalThis.fetch = Object.assign(falso, { preconnect: FETCH_ORIGINAL.preconnect });
}

const ok = (cod: string, o?: OpcoesHtml) => (): Response => new Response(htmlConsulta(cod, o), { status: 200 });

const APRESENTACAO = "2023-05-10T15:00:00Z";

async function semear(
  codigos: string[],
  parlamentarId = "senado:9001",
  dataApresentacao: string | null = null,
): Promise<void> {
  await sql`insert into parlamentar (id, casa, id_externo, nome, busca)
    values (${parlamentarId}, 'senado', '9001', 'Parlamentar Teste', 'parlamentar teste')`;
  for (const cod of codigos) {
    const id = `senado:${cod}`;
    await sql`insert into proposicao (id, casa, id_externo, sigla_tipo, numero, ano, data_apresentacao)
      values (${id}, 'senado', ${cod}, 'PL', 1, 2026, ${dataApresentacao})`;
    await sql`insert into proposicao_autor (proposicao_id, parlamentar_id, ordem) values (${id}, ${parlamentarId}, 1)`;
  }
}

async function semearCursor(puladas: unknown): Promise<void> {
  const json = typeof puladas === "string" ? puladas : JSON.stringify({ puladas });
  await sql`insert into ingest_cursor (fonte, estado) values ('senado:consultas', ${json}::jsonb)`;
}

async function bloquearEventos(): Promise<void> {
  await sql`create or replace function falha_evento_teste() returns trigger language plpgsql as $$
    begin raise exception 'evento bloqueado pelo teste'; end $$`;
  await sql`create trigger falha_evento_teste before insert on evento for each row execute function falha_evento_teste()`;
}

async function bloquearAtualizacaoEventos(): Promise<void> {
  await sql`create or replace function falha_evento_update_teste() returns trigger language plpgsql as $$
    begin raise exception 'update de evento bloqueado pelo teste'; end $$`;
  await sql`create trigger falha_evento_update_teste before update on evento for each row execute function falha_evento_update_teste()`;
}

async function liberarEventos(): Promise<void> {
  await sql`drop trigger if exists falha_evento_teste on evento`;
  await sql`drop function if exists falha_evento_teste()`;
  await sql`drop trigger if exists falha_evento_update_teste on evento`;
  await sql`drop function if exists falha_evento_update_teste()`;
}

interface LinhaEvento {
  ref_id: string;
  ocorrido_em: Date | string;
  sim: string;
  nao: string;
}

const eventos = (): Promise<LinhaEvento[]> =>
  sql<LinhaEvento[]>`select ref_id, ocorrido_em, resumo->>'votosSim' as sim, resumo->>'votosNao' as nao
    from evento where tipo = 'consulta_publica' order by ref_id`;

const placarTabela = async (cod: string): Promise<{ sim: string; nao: string }> => {
  const [r] = await sql<
    { sim: string; nao: string }[]
  >`select votos_sim::text as sim, votos_nao::text as nao from consulta_publica where materia_cod = ${cod}`;
  return r ?? { sim: "?", nao: "?" };
};

const contar = async (tabela: "consulta_publica" | "evento"): Promise<number> => {
  const [r] =
    tabela === "evento"
      ? await sql<{ n: number }[]>`select count(*)::int as n from evento`
      : await sql<{ n: number }[]>`select count(*)::int as n from consulta_publica`;
  return r?.n ?? -1;
};

interface LinhaConsulta {
  votos_sim: number;
  apurado_em: Date | string;
}

const linha = async (cod: string): Promise<LinhaConsulta | undefined> => {
  const [r] = await sql<
    LinhaConsulta[]
  >`select votos_sim, apurado_em from consulta_publica where materia_cod = ${cod}`;
  return r;
};

// o driver pode devolver Date ou texto conforme a config do cliente: normaliza para ISO
const instante = (l: LinhaConsulta | undefined): string => new Date(l?.apurado_em ?? 0).toISOString();

const agoraIso = (): string => new Date().toISOString();

beforeAll(async () => {
  sql = await prepararBancoDeTeste();
  ({ sincronizarConsultas } = await import("./consultas"));
  base = await fixture("p160575.html");
  const hdr = await fixture("p999999999.hdr");
  statusRedirecao = Number(/^HTTP\/1\.1 (\d{3})/.exec(hdr)?.[1]);
});

beforeEach(async () => {
  // truncate no inicio de cada teste: repetivel entre execucoes seguidas
  await liberarEventos();
  await limparTabelas(sql);
  logs = [];
  chamadas = [];
  console.log = (...a: unknown[]): void => {
    logs.push(a.map(String).join(" "));
  };
});

afterEach(async () => {
  globalThis.fetch = FETCH_ORIGINAL;
  console.log = CONSOLE_LOG_ORIGINAL;
  await liberarEventos();
});

describe("setWhere: leitura mais antiga nao sobrescreve", () => {
  test("C49 leitura com apurado_em mais antiga nao sobrescreve a linha nem gera evento", async () => {
    await semear(["160575"]);
    simularFetch({ "160575": ok("160575", { sim: 100, apuracao: "28/10/2026 10:18:46" }) });
    const r1 = await sincronizarConsultas();
    expect(r1).toMatchObject({ lidas: 1, eventos: 1, falhas: 0 });

    // mes anterior: sem o setWhere a linha seria sobrescrita e um evento novo seria criado
    simularFetch({ "160575": ok("160575", { sim: 999, apuracao: "15/09/2026 10:00:00" }) });
    const r2 = await sincronizarConsultas();
    expect(r2.lidas).toBe(0);
    expect(r2.puladas).toBe(1);
    expect(r2.eventos).toBe(0);
    expect(r2.falhas).toBe(0);
    expect(Object.keys(r2.registroPuladas).join(",")).toBe("");
    const l = await linha("160575");
    expect(l?.votos_sim).toBe(100);
    expect(instante(l)).toBe("2026-10-28T13:18:46.000Z");
    expect(await contar("evento")).toBe(1);
  });

  test("C50 leitura com apurado_em igual ou mais nova sobrescreve a linha e atualiza o evento unico", async () => {
    await semear(["160575"], "senado:9001", APRESENTACAO);
    simularFetch({ "160575": ok("160575", { sim: 100, apuracao: "28/10/2026 10:18:46" }) });
    await sincronizarConsultas();

    simularFetch({ "160575": ok("160575", { sim: 200, apuracao: "28/10/2026 10:18:46" }) });
    const igual = await sincronizarConsultas();
    expect(igual.lidas).toBe(1);
    expect(igual.puladas).toBe(0);
    expect(igual.eventos).toBe(1);
    expect((await linha("160575"))?.votos_sim).toBe(200);

    simularFetch({ "160575": ok("160575", { sim: 300, apuracao: "29/11/2026 09:00:00" }) });
    const nova = await sincronizarConsultas();
    expect(nova.lidas).toBe(1);
    expect(nova.puladas).toBe(0);
    expect(nova.eventos).toBe(1);
    const l = await linha("160575");
    expect(l?.votos_sim).toBe(300);
    expect(instante(l)).toBe("2026-11-29T12:00:00.000Z");
    expect(await contar("evento")).toBe(1);
  });
});

describe("isolamento por item", () => {
  test("C51 item com leitura invalida nao derruba os demais, que sao gravados", async () => {
    await semear(["160575", "172395", "176111"]);
    simularFetch({
      "160575": ok("160575"),
      // placar ilegivel: o parser devolve template_alterado e a leitura nao e gravavel
      "172395": () =>
        new Response(htmlConsulta("172395").replace(">100</span>", ">abc</span>"), { status: 200 }),
      "176111": ok("176111"),
    });
    const r = await sincronizarConsultas();
    expect(r.lidas).toBe(2);
    expect(r.falhas).toBe(1);
    expect(r.puladas).toBe(0);
    expect(r.abortou).toBe(false);
    expect(r.registroPuladas["172395"]?.motivo).toBe("falha_leitura");
    expect(Object.keys(r.registroPuladas).join(",")).toBe("172395");
    expect(await linha("160575")).toBeDefined();
    expect(await linha("172395")).toBeUndefined();
    expect(await linha("176111")).toBeDefined();
  });

  test("C52 excecao de buscarTexto e 302 real em itens vizinhos nao derrubam os demais", async () => {
    await semear(["160575", "172395", "999999999"]);
    simularFetch({
      "160575": ok("160575"),
      // 404 nao tem retry em buscarTexto: lanca `404 em <url>`
      "172395": () => new Response("fora do ar", { status: 404 }),
      // resposta do .hdr real: 302 -> materia inexistente (pulo, nao excecao)
      "999999999": () => new Response(null, { status: statusRedirecao, headers: { location: "principalmateria" } }),
    });
    const saida = await sincronizarConsultas().catch((e: unknown) => e);
    // a excecao do item 172395 nao pode escapar da rodada
    expect(saida).not.toBeInstanceOf(Error);
    const r = saida as Awaited<ReturnType<typeof sincronizarConsultas>>;
    expect(statusRedirecao).toBe(302);
    expect(r).toMatchObject({ lidas: 1, falhas: 1, puladas: 1, abortou: false });
    expect(r.registroPuladas["172395"]?.motivo).toBe("falha_leitura");
    expect(r.registroPuladas["999999999"]?.motivo).toBe("materia_inexistente");
    expect(Object.keys(r.registroPuladas).sort()).toEqual(["172395", "999999999"]);
    expect(await linha("160575")).toBeDefined();
    expect(await contar("consulta_publica")).toBe(1);
  });
});

describe("gravacao: rollback e contagem (T2)", () => {
  test("C53 falha dentro da transacao desfaz tambem o upsert de consulta_publica", async () => {
    await semear(["160575"]);
    await bloquearEventos();
    simularFetch({ "160575": ok("160575") });
    const r = await sincronizarConsultas();
    expect(r).toMatchObject({ lidas: 0, eventos: 0, falhas: 1 });
    expect(await contar("consulta_publica")).toBe(0);
    expect(await linha("160575")).toBeUndefined();
    expect(await contar("evento")).toBe(0);
  });

  test("C96 duas rodadas em meses diferentes geram 1 evento com o placar da 2a e ocorrido_em da apresentacao", async () => {
    await semear(["160575"], "senado:9001", APRESENTACAO);
    simularFetch({ "160575": ok("160575", { sim: 100, nao: 50, apuracao: "28/10/2026 10:18:46" }) });
    await sincronizarConsultas();
    const antes = await eventos();
    expect(antes).toHaveLength(1);
    expect(new Date(antes[0]?.ocorrido_em ?? 0).toISOString()).toBe("2023-05-10T15:00:00.000Z");

    simularFetch({ "160575": ok("160575", { sim: 300, nao: 70, apuracao: "29/11/2026 09:00:00" }) });
    await sincronizarConsultas();
    const depois = await eventos();
    expect(depois).toHaveLength(1);
    expect(depois[0]?.ref_id).toBe("senado:160575:2023-05");
    expect(depois[0]?.sim).toBe("300");
    expect(depois[0]?.nao).toBe("70");
    expect(new Date(depois[0]?.ocorrido_em ?? 0).toISOString()).toBe("2023-05-10T15:00:00.000Z");
  });

  test("C97 leitura mais antiga que a gravada mantem tabela e evento com o placar anterior", async () => {
    await semear(["160575"], "senado:9001", APRESENTACAO);
    simularFetch({ "160575": ok("160575", { sim: 100, nao: 50, apuracao: "28/10/2026 10:18:46" }) });
    await sincronizarConsultas();
    simularFetch({ "160575": ok("160575", { sim: 999, nao: 888, apuracao: "15/09/2026 10:00:00" }) });
    await sincronizarConsultas();
    expect(await placarTabela("160575")).toEqual({ sim: "100", nao: "50" });
    const ev = await eventos();
    expect(ev).toHaveLength(1);
    expect([ev[0]?.sim, ev[0]?.nao]).toEqual(["100", "50"]);
  });

  test("C98 resumo do evento fica igual ao placar de consulta_publica apos cada rodada", async () => {
    await semear(["160575"], "senado:9001", APRESENTACAO);
    const rodadas = [
      { sim: 100, nao: 50, apuracao: "28/10/2026 10:18:46" },
      { sim: 250, nao: 60, apuracao: "29/10/2026 08:00:00" },
      { sim: 251, nao: 61, apuracao: "03/12/2026 08:00:00" },
    ];
    for (const o of rodadas) {
      simularFetch({ "160575": ok("160575", o) });
      await sincronizarConsultas();
      const tabela = await placarTabela("160575");
      const ev = await eventos();
      expect(ev).toHaveLength(1);
      expect({ sim: ev[0]?.sim, nao: ev[0]?.nao }).toEqual(tabela);
      expect(tabela).toEqual({ sim: String(o.sim), nao: String(o.nao) });
    }
  });

  test("C99 contador conta o evento gravado e rodada repetida nao cria linha nova", async () => {
    await semear(["160575"], "senado:9001", APRESENTACAO);
    simularFetch({ "160575": ok("160575", { sim: 100, nao: 50, apuracao: "28/10/2026 10:18:46" }) });
    const r1 = await sincronizarConsultas();
    expect(r1).toMatchObject({ lidas: 1, eventos: 1, falhas: 0 });
    expect(await contar("evento")).toBe(1);
    const r2 = await sincronizarConsultas();
    expect(r2).toMatchObject({ lidas: 1, eventos: 1, falhas: 0 });
    expect(await contar("evento")).toBe(1);
  });

  test("C100 falha ao atualizar o evento desfaz tambem o upsert de consulta_publica", async () => {
    await semear(["160575"], "senado:9001", APRESENTACAO);
    simularFetch({ "160575": ok("160575", { sim: 100, nao: 50, apuracao: "28/10/2026 10:18:46" }) });
    await sincronizarConsultas();
    await bloquearAtualizacaoEventos();
    simularFetch({ "160575": ok("160575", { sim: 300, nao: 70, apuracao: "29/11/2026 09:00:00" }) });
    const r = await sincronizarConsultas();
    expect(r).toMatchObject({ lidas: 0, falhas: 1 });
    expect(await placarTabela("160575")).toEqual({ sim: "100", nao: "50" });
    const ev = await eventos();
    expect(ev).toHaveLength(1);
    expect([ev[0]?.sim, ev[0]?.nao]).toEqual(["100", "50"]);
  });

  test("C54 excecao de gravacao conta falhas, nao altera puladas e nao entra no mapa de puladas", async () => {
    await semear(["160575", "172395"]);
    await bloquearEventos();
    simularFetch({ "160575": ok("160575"), "172395": ok("172395") });
    const r = await sincronizarConsultas();
    expect(r.falhas).toBe(2);
    expect(r.puladas).toBe(0);
    expect(r.abortou).toBe(false);
    expect(Object.keys(r.registroPuladas).join(",")).toBe("");
  });

  test("C55 excecao de leitura registra falha_leitura no mapa de puladas", async () => {
    await semear(["160575"]);
    simularFetch({ "160575": () => new Response("erro", { status: 404 }) });
    const r = await sincronizarConsultas();
    expect(r).toMatchObject({ falhas: 1, puladas: 0, lidas: 0 });
    expect(r.registroPuladas["160575"]?.motivo).toBe("falha_leitura");
  });

  test("C56 falhas de gravacao seguidas abortam a rodada pelo contador, sem pular itens", async () => {
    const codigos = Array.from({ length: 12 }, (_, i) => String(100001 + i));
    await semear(codigos);
    await bloquearEventos();
    simularFetch(Object.fromEntries(codigos.map((c) => [c, ok(c)])));
    const r = await sincronizarConsultas();
    expect(r.abortou).toBe(true);
    expect(r.falhas).toBe(10);
    expect(r.puladas).toBe(0);
    expect(r.lidas).toBe(0);
    expect(chamadas.length).toBe(10);
    expect(r.registroPuladas).toEqual({});
  });
});

describe("puladasDoCursor via cursor semeado", () => {
  const valida = (): { em: string; motivo: string } => ({ em: agoraIso(), motivo: "encerrada" });

  test("C57 chave __proto__ e descartada", async () => {
    // JSON cru: `__proto__` vira propriedade propria no JSON.parse, nao o prototipo
    await semearCursor(
      JSON.stringify({ puladas: { "7": valida() } }).replace(
        '{"7"',
        `{"__proto__":${JSON.stringify(valida())},"7"`,
      ),
    );
    const r = await sincronizarConsultas();
    expect(Object.keys(r.registroPuladas).join(",")).toBe("7");
    expect(Object.getPrototypeOf(r.registroPuladas)).toBe(Object.prototype);
  });

  test("C58 chave 0 e descartada", async () => {
    await semearCursor({ "0": valida(), "7": valida() });
    const r = await sincronizarConsultas();
    expect(Object.keys(r.registroPuladas).join(",")).toBe("7");
  });

  test("C59 chave 01 e descartada", async () => {
    await semearCursor({ "01": valida(), "7": valida() });
    const r = await sincronizarConsultas();
    expect(Object.keys(r.registroPuladas).join(",")).toBe("7");
  });

  test("C60 chave nao numerica e descartada", async () => {
    await semearCursor({ abc: valida(), "7": valida() });
    const r = await sincronizarConsultas();
    expect(Object.keys(r.registroPuladas).join(",")).toBe("7");
  });

  test("C61 motivo fora da allowlist DIAS_PULO_POR_MOTIVO e descartado", async () => {
    await semearCursor({
      "5": { em: agoraIso(), motivo: "inventado" },
      "6": { em: agoraIso(), motivo: "toString" },
      "7": valida(),
    });
    const r = await sincronizarConsultas();
    expect(Object.keys(r.registroPuladas).join(",")).toBe("7");
    expect(r.registroPuladas["7"]?.motivo).toBe("encerrada");
  });

  test("C62 em invalido e descartado e a entrada valida do mesmo cursor e mantida", async () => {
    await semearCursor({
      "5": { em: "nao-e-data", motivo: "encerrada" },
      "6": { em: 123, motivo: "encerrada" },
      "7": valida(),
    });
    const r = await sincronizarConsultas();
    expect(Object.keys(r.registroPuladas).join(",")).toBe("7");
  });
});

describe("descreverErro", () => {
  test("C63 mensagem sem o trecho params: e truncada em 200", async () => {
    await semear(["160575", "172395"]);
    const falhaNoCorpo = (msg: string) => (): Response =>
      new Response(
        new ReadableStream({
          start(c) {
            c.error(new Error(msg));
          },
        }),
        { status: 200 },
      );
    simularFetch({
      "160575": falhaNoCorpo("falha de leitura\nparams: SEGREDO-FORJADO-123"),
      "172395": falhaNoCorpo("y".repeat(500)),
    });
    const r = await sincronizarConsultas();
    expect(r.falhas).toBe(2);
    const saida = logs.join("\n");
    expect(saida).toContain("[senado] consultas: falhou 160575 (Error: falha de leitura)");
    expect(saida).not.toContain("SEGREDO-FORJADO-123");
    expect(saida).not.toContain("params:");
    expect(logs).toContain(`[senado] consultas: falhou 172395 (Error: ${"y".repeat(200)})`);
    expect(JSON.stringify(r.registroPuladas)).not.toContain("SEGREDO");
  });
});

describe("repetibilidade", () => {
  test("C64 o truncate do inicio deixa duas rodadas seguidas com o mesmo resultado", async () => {
    const rodar = async () => {
      await limparTabelas(sql);
      await semear(["160575"]);
      simularFetch({ "160575": ok("160575") });
      const r = await sincronizarConsultas();
      return { r, linhas: await contar("consulta_publica"), eventos: await contar("evento") };
    };
    const a = await rodar();
    const b = await rodar();
    expect(a.r).toMatchObject({ lidas: 1, eventos: 1, falhas: 0 });
    expect(b.r).toEqual(a.r);
    expect([b.linhas, b.eventos]).toEqual([1, 1]);
  });
});
