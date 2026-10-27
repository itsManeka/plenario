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

export async function buscarJson<T>(url: string, tentativas = 5): Promise<T> {
  await vaga();
  try {
    for (let i = 1; ; i++) {
      let res: Response;
      try {
        res = await fetch(url, {
          headers: { Accept: "application/json", "User-Agent": UA },
          signal: AbortSignal.timeout(60_000),
        });
      } catch (e) {
        if (i >= tentativas) throw e;
        await Bun.sleep(500 * 2 ** i);
        continue;
      }
      if (res.ok) return (await res.json()) as T;
      if ((res.status === 429 || res.status >= 500) && i < tentativas) {
        await Bun.sleep(500 * 2 ** i);
        continue;
      }
      throw new Error(`${res.status} em ${url}`);
    }
  } finally {
    liberar();
  }
}
