import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { buscarJson, buscarTexto } from "./http";

type Chamada = { url: string; init: RequestInit | undefined };

const fetchOriginal = globalThis.fetch;
let chamadas: Chamada[] = [];
let respostas: (() => Response)[] = [];
let sleeps: number[] = [];
let sleepSpy: ReturnType<typeof spyOn>;

function stubFetch(fabricas: (() => Response)[]) {
  respostas = [...fabricas];
  chamadas = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    chamadas.push({ url: String(input), init });
    const proxima = respostas.shift();
    if (!proxima) throw new Error("fetch sem resposta stubada");
    return proxima();
  }) as typeof fetch;
}

function cabecalho(c: Chamada, nome: string): string | undefined {
  const h = c.init?.headers as Record<string, string> | undefined;
  return h?.[nome];
}

beforeEach(() => {
  sleeps = [];
  sleepSpy = spyOn(Bun, "sleep").mockImplementation(async (ms: number | Date) => {
    sleeps.push(Number(ms));
  });
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
  sleepSpy.mockRestore();
});

describe("buscarTexto", () => {
  it("C17: envia Accept text/html e o UA, devolve ok com o corpo", async () => {
    stubFetch([() => new Response("<html>oi</html>", { status: 200 })]);
    const r = await buscarTexto("https://exemplo.test/a");
    expect(r).toEqual({ tipo: "ok", corpo: "<html>oi</html>" });
    expect(chamadas).toHaveLength(1);
    expect(cabecalho(chamadas[0]!, "Accept")).toBe("text/html");
    expect(cabecalho(chamadas[0]!, "User-Agent")).toStartWith("plenario/0.1");
  });

  it("C18: 302 devolve redirecionada sem retry", async () => {
    stubFetch([() => new Response(null, { status: 302 }), () => new Response("x", { status: 200 })]);
    const r = await buscarTexto("https://exemplo.test/b");
    expect(r).toEqual({ tipo: "redirecionada", status: 302 });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]!.init?.redirect).toBe("manual");
  });

  it("C19: 500 seguido de 200 refaz e devolve ok", async () => {
    stubFetch([() => new Response("erro", { status: 500 }), () => new Response("ok", { status: 200 })]);
    const r = await buscarTexto("https://exemplo.test/c");
    expect(r).toEqual({ tipo: "ok", corpo: "ok" });
    expect(chamadas).toHaveLength(2);
    expect(sleeps).toHaveLength(1);
  });

  it("C19: 429 seguido de 200 refaz e devolve ok", async () => {
    stubFetch([() => new Response("lento", { status: 429 }), () => new Response("ok", { status: 200 })]);
    const r = await buscarTexto("https://exemplo.test/d");
    expect(r).toEqual({ tipo: "ok", corpo: "ok" });
    expect(chamadas).toHaveLength(2);
  });

  it("C20: 404 lanca sem retry", async () => {
    const url = "https://exemplo.test/e";
    stubFetch([() => new Response("nada", { status: 404 }), () => new Response("x", { status: 200 })]);
    const resultado = await buscarTexto(url).then(
      () => "resolveu",
      (e: unknown) => (e instanceof Error ? e.message : "erro estranho"),
    );
    expect(resultado).toBe(`404 em ${url}`);
    expect(chamadas).toHaveLength(1);
  });
});

describe("buscarJson", () => {
  it("C21: mantem Accept application/json e UA", async () => {
    stubFetch([() => new Response(JSON.stringify({ a: 1 }), { status: 200 })]);
    const r = await buscarJson<{ a: number }>("https://exemplo.test/j");
    expect(r).toEqual({ a: 1 });
    expect(cabecalho(chamadas[0]!, "Accept")).toBe("application/json");
    expect(cabecalho(chamadas[0]!, "User-Agent")).toStartWith("plenario/0.1");
    expect(chamadas[0]!.init?.redirect).toBe("follow");
  });
});
