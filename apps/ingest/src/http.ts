// Cliente HTTP único para as fontes públicas. São serviços do Estado, sem SLA e sem
// chave: o projeto tem que ser um bom vizinho. Concorrência baixa, User-Agent que
// se identifica e backoff em 429/5xx.

const UA = "plenario/0.1 (+https://github.com/tonhonho/plenario; dados abertos, sem fins lucrativos)";
const MAX_CONCORRENCIA = Number(process.env.INGEST_CONCORRENCIA ?? 4);

let emVoo = 0;
const fila: (() => void)[] = [];

async function vaga(): Promise<void> {
  if (emVoo < MAX_CONCORRENCIA) {
    emVoo++;
    return;
  }
  await new Promise<void>((ok) => fila.push(ok));
  emVoo++;
}

function liberar() {
  emVoo--;
  fila.shift()?.();
}

interface OpcoesNucleo<R> {
  accept: string;
  redirect: RequestRedirect;
  /** Resposta 2xx: le o corpo ainda com a vaga ocupada. */
  lerOk: (res: Response) => Promise<R>;
  /** Resposta nao-ok sem retry (4xx, 3xx, 429/5xx esgotados): devolve ou lanca. */
  lerNaoOk: (res: Response) => R;
}

/** Nucleo comum: vaga na fila, fetch com timeout, retry/backoff em erro de rede, 429 e >=500. */
async function buscarNucleo<R>(url: string, tentativas: number, opts: OpcoesNucleo<R>): Promise<R> {
  await vaga();
  try {
    for (let i = 1; ; i++) {
      let res: Response;
      try {
        res = await fetch(url, {
          headers: { Accept: opts.accept, "User-Agent": UA },
          redirect: opts.redirect,
          signal: AbortSignal.timeout(60_000),
        });
      } catch (e) {
        if (i >= tentativas) throw e;
        await Bun.sleep(500 * 2 ** i);
        continue;
      }
      if (res.ok) return await opts.lerOk(res);
      if ((res.status === 429 || res.status >= 500) && i < tentativas) {
        await Bun.sleep(500 * 2 ** i);
        continue;
      }
      return opts.lerNaoOk(res);
    }
  } finally {
    liberar();
  }
}

export async function buscarJson<T>(url: string, tentativas = 5): Promise<T> {
  return buscarNucleo<T>(url, tentativas, {
    accept: "application/json",
    redirect: "follow",
    lerOk: async (res) => (await res.json()) as T,
    lerNaoOk: (res) => {
      throw new Error(`${res.status} em ${url}`);
    },
  });
}

/** Resultado de buscarTexto: 3xx nao e seguido nem tem retry (materia inexistente, cf. f04). */
export type RespostaTexto = { tipo: "ok"; corpo: string } | { tipo: "redirecionada"; status: number };

export async function buscarTexto(url: string, tentativas = 5): Promise<RespostaTexto> {
  return buscarNucleo<RespostaTexto>(url, tentativas, {
    accept: "text/html",
    redirect: "manual",
    lerOk: async (res) => ({ tipo: "ok", corpo: await res.text() }),
    lerNaoOk: (res) => {
      if (res.status >= 300 && res.status < 400) {
        return { tipo: "redirecionada", status: res.status };
      }
      throw new Error(`${res.status} em ${url}`);
    },
  });
}
