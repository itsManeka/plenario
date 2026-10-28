// Arquivos em lote da Câmara: download com cache local, retomada por Range e leitura em
// streaming. Os JSON chegam a ~100 MB (e o CEAP descompactado passa de 130 MB), então nada
// aqui carrega o arquivo inteiro como objeto.

import { createWriteStream, existsSync, mkdirSync, statSync, unlinkSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createInflateRaw } from "node:zlib";
import { log } from "./comum";

const UA = "plenario/0.1 (+https://github.com/tonhonho/plenario; dados abertos, sem fins lucrativos)";
const DIR_CACHE = process.env.INGEST_CACHE_DIR ?? join(tmpdir(), "plenario-ingest", "camara");

export interface Arquivo {
  caminho: string;
  etag: string;
}

async function cabecalho(url: string): Promise<{ etag: string; tamanho: number } | null> {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, {
        method: "HEAD",
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 404) return null;
      if (res.ok) {
        return {
          etag: res.headers.get("etag") ?? res.headers.get("last-modified") ?? "",
          tamanho: Number(res.headers.get("content-length") ?? -1),
        };
      }
      if (i >= 5 || (res.status !== 429 && res.status < 500)) throw new Error(`${res.status} em HEAD ${url}`);
    } catch (e) {
      if (i >= 5) throw e;
    }
    await Bun.sleep(1000 * 2 ** i);
  }
}

/**
 * Etag atual do arquivo na fonte, sem baixar (null se não existe). No incremental, comparar
 * isto com o etag já processado evita baixar de novo arquivo que não mudou, mesmo sem cache
 * local (no CI o banco é restaurado, mas a pasta de cache não).
 */
export async function etagRemoto(url: string): Promise<string | null> {
  return (await cabecalho(url))?.etag ?? null;
}

/**
 * Baixa `url` para o cache e devolve o caminho + etag. Se o cache já tem esse etag, não baixa.
 * Devolve null se o arquivo não existe na fonte (ex.: ano sem dado ainda).
 *
 * O servidor de arquivos da Câmara derruba conexões longas (~15 s) no meio da transferência,
 * então o download retoma com `Range` até bater o `content-length`.
 */
export async function baixar(url: string): Promise<Arquivo | null> {
  const cab = await cabecalho(url);
  if (!cab) return null;
  mkdirSync(DIR_CACHE, { recursive: true });
  const nome = url.split("/").pop()!;
  const caminho = join(DIR_CACHE, nome);
  const arqEtag = `${caminho}.etag`;
  if (existsSync(caminho) && existsSync(arqEtag) && (await Bun.file(arqEtag).text()) === cab.etag) {
    return { caminho, etag: cab.etag };
  }

  const parcial = `${caminho}.parcial`;
  if (existsSync(parcial)) unlinkSync(parcial);
  const inicio = Date.now();
  let falhas = 0;
  for (;;) {
    const ja = existsSync(parcial) ? statSync(parcial).size : 0;
    if (cab.tamanho >= 0 && ja >= cab.tamanho) break;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, ...(ja > 0 ? { Range: `bytes=${ja}-` } : {}) },
        signal: AbortSignal.timeout(300_000),
      });
      if (ja > 0 && res.status !== 206) throw new Error(`esperava 206 ao retomar, veio ${res.status}`);
      if (!res.ok || !res.body) throw new Error(`${res.status} em ${url}`);
      const saida = createWriteStream(parcial, { flags: "a" });
      try {
        for await (const pedaco of res.body as unknown as AsyncIterable<Uint8Array>) {
          if (!saida.write(pedaco)) await new Promise((ok) => saida.once("drain", ok));
        }
      } finally {
        await new Promise((ok) => saida.end(ok));
      }
      if (cab.tamanho < 0) break; // sem content-length: confia no fim do stream
    } catch (e) {
      // conexão derrubada no meio: retoma do ponto onde parou
      if (++falhas > 30) throw e;
      await Bun.sleep(Math.min(1000 * falhas, 10_000));
    }
  }
  if (cab.tamanho >= 0 && statSync(parcial).size !== cab.tamanho) {
    throw new Error(`download incompleto de ${url}`);
  }
  renameSync(parcial, caminho);
  await Bun.write(arqEtag, cab.etag);
  const mb = (statSync(caminho).size / 1e6).toFixed(1);
  log(`baixado ${nome} (${mb} MB em ${((Date.now() - inicio) / 1000).toFixed(0)}s${falhas ? `, ${falhas} retomadas` : ""})`);
  return { caminho, etag: cab.etag };
}

export function bytesDoArquivo(caminho: string): AsyncIterable<Uint8Array> {
  return Bun.file(caminho).stream() as unknown as AsyncIterable<Uint8Array>;
}

/**
 * Descompacta, em streaming, a única entrada de um .zip (o CEAP vem assim). Lê o tamanho
 * comprimido no diretório central, que é confiável mesmo quando o cabeçalho local usa
 * data descriptor.
 */
export function bytesDoZip(caminho: string): AsyncIterable<Uint8Array> {
  return (async function* () {
    const buf = Buffer.from(await Bun.file(caminho).arrayBuffer());
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error(`zip inválido: ${caminho}`);
    const cd = buf.readUInt32LE(eocd + 16);
    if (buf.readUInt32LE(cd) !== 0x02014b50) throw new Error(`diretório central inválido: ${caminho}`);
    const metodo = buf.readUInt16LE(cd + 10);
    const comprimido = buf.readUInt32LE(cd + 20);
    const local = buf.readUInt32LE(cd + 42);
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error(`cabeçalho local inválido: ${caminho}`);
    const dados = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const corpo = buf.subarray(dados, dados + comprimido);
    if (metodo === 0) {
      yield corpo;
      return;
    }
    if (metodo !== 8) throw new Error(`zip com método ${metodo} não suportado: ${caminho}`);
    const inflar = Readable.from([corpo]).pipe(createInflateRaw());
    for await (const pedaco of inflar as AsyncIterable<Buffer>) yield pedaco;
  })();
}

/**
 * Itera os elementos do array `dados` de um JSON `{"dados": [ {...}, {...} ]}` sem montar o
 * documento inteiro: varre os caracteres contando profundidade (fora de string) e faz
 * JSON.parse de cada objeto de nível 3 isoladamente.
 */
export async function* lerDados<T>(bytes: AsyncIterable<Uint8Array>): AsyncGenerator<T> {
  const dec = new TextDecoder("utf-8");
  let prof = 0;
  let emString = false;
  let escape = false;
  let acumulado = ""; // trecho do elemento corrente que veio de pedaços anteriores
  let dentroElemento = false;

  for await (const pedaco of bytes) {
    const txt = dec.decode(pedaco, { stream: true });
    let inicio = dentroElemento ? 0 : -1;
    for (let i = 0; i < txt.length; i++) {
      const c = txt.charCodeAt(i);
      if (emString) {
        if (escape) escape = false;
        else if (c === 92 /* \ */) escape = true;
        else if (c === 34 /* " */) emString = false;
        continue;
      }
      if (c === 34) emString = true;
      else if (c === 123 /* { */ || c === 91 /* [ */) {
        prof++;
        if (prof === 3 && c === 123) {
          dentroElemento = true;
          inicio = i;
          acumulado = "";
        }
      } else if (c === 125 /* } */ || c === 93 /* ] */) {
        prof--;
        if (prof === 2 && dentroElemento) {
          const texto = acumulado + txt.slice(inicio, i + 1);
          acumulado = "";
          dentroElemento = false;
          inicio = -1;
          yield JSON.parse(texto) as T;
        }
      }
    }
    if (dentroElemento) acumulado += txt.slice(inicio);
  }
}
