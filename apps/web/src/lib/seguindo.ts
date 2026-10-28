import { useCallback, useSyncExternalStore } from "react";

// "Seguir" sem conta: lista de ids no localStorage do navegador. Nada sai daqui.
// Todo acesso ao storage é protegido: em modo privado (ou com storage bloqueado)
// ele pode lançar, e aí a lista vive só na memória desta aba.

export const CHAVE = "plenario:seguindo";
const EVENTO_LOCAL = "plenario:seguindo-mudou";
const ID_VALIDO = /^(camara|senado):[A-Za-z0-9_-]{1,40}$/;

export function idValido(id: string): boolean {
  return ID_VALIDO.test(id);
}

/** Limpa, valida e tira duplicados, preservando a ordem. */
export function sanitizar(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const bruto of ids) {
    if (typeof bruto !== "string") continue;
    const id = bruto.trim();
    if (!idValido(id) || vistos.has(id)) continue;
    vistos.add(id);
    saida.push(id);
  }
  return saida;
}

let memoria: string[] = [];
let storageOk = true;
let cache: { bruto: string | null; ids: string[] } | null = null;

function lerBruto(): string | null {
  if (!storageOk) return null;
  try {
    return window.localStorage.getItem(CHAVE);
  } catch {
    storageOk = false;
    return null;
  }
}

function ler(): string[] {
  if (!storageOk) return memoria;
  const bruto = lerBruto();
  if (!storageOk) return memoria;
  // useSyncExternalStore exige a mesma referência enquanto nada mudou
  if (cache && cache.bruto === bruto) return cache.ids;
  let ids: string[] = [];
  if (bruto) {
    try {
      ids = sanitizar(JSON.parse(bruto));
    } catch {
      ids = [];
    }
  }
  cache = { bruto, ids };
  return ids;
}

function gravar(ids: string[]): void {
  const limpos = sanitizar(ids);
  memoria = limpos;
  if (storageOk) {
    try {
      window.localStorage.setItem(CHAVE, JSON.stringify(limpos));
    } catch {
      storageOk = false;
    }
  }
  window.dispatchEvent(new Event(EVENTO_LOCAL));
}

function assinar(avisar: () => void): () => void {
  // `storage` só dispara nas OUTRAS abas; o evento local cobre a aba atual.
  const aoStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === CHAVE) avisar();
  };
  window.addEventListener("storage", aoStorage);
  window.addEventListener(EVENTO_LOCAL, avisar);
  return () => {
    window.removeEventListener("storage", aoStorage);
    window.removeEventListener(EVENTO_LOCAL, avisar);
  };
}

const VAZIO: string[] = [];

export function storageDisponivel(): boolean {
  ler();
  return storageOk;
}

export function useSeguindo() {
  const ids = useSyncExternalStore(assinar, ler, () => VAZIO);

  const segue = useCallback((id: string) => ids.includes(id), [ids]);
  const seguir = useCallback((id: string) => gravar([...ler(), id]), []);
  const deixarDeSeguir = useCallback(
    (id: string) => gravar(ler().filter((x) => x !== id)),
    [],
  );
  const alternar = useCallback((id: string) => {
    const atual = ler();
    gravar(atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id]);
  }, []);
  /** Junta à lista atual; devolve quantos eram novos. */
  const adicionarVarios = useCallback((novos: string[]) => {
    const atual = ler();
    const limpos = sanitizar(novos).filter((id) => !atual.includes(id));
    gravar([...atual, ...limpos]);
    return limpos.length;
  }, []);
  const substituir = useCallback((novos: string[]) => gravar(novos), []);

  return { ids, segue, seguir, deixarDeSeguir, alternar, adicionarVarios, substituir };
}

// ---- exportar / importar ----

export interface ArquivoSeguindo {
  formato: "plenario-seguindo";
  versao: 1;
  exportadoEm: string;
  ids: string[];
}

export function paraArquivo(ids: string[]): ArquivoSeguindo {
  return { formato: "plenario-seguindo", versao: 1, exportadoEm: new Date().toISOString(), ids };
}

/**
 * Aceita o JSON exportado, um array de ids, um link com `?seguir=` ou ids
 * separados por vírgula/espaço. Devolve só ids válidos.
 */
export function lerImportacao(texto: string): string[] {
  const t = texto.trim();
  if (!t) return [];
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      const dado: unknown = JSON.parse(t);
      if (Array.isArray(dado)) return sanitizar(dado);
      if (dado && typeof dado === "object" && "ids" in dado) {
        return sanitizar((dado as { ids: unknown }).ids);
      }
    } catch {
      return [];
    }
    return [];
  }
  try {
    const url = new URL(t);
    const p = url.searchParams.get("seguir");
    if (p !== null) return idsDoParametro(p);
  } catch {
    // não é URL: segue como lista solta
  }
  return sanitizar(t.split(/[\s,;]+/));
}

export function idsDoParametro(valor: string): string[] {
  return sanitizar(valor.split(","));
}

export function linkCompartilhavel(ids: string[]): string {
  const base = `${window.location.origin}${import.meta.env.BASE_URL}seguindo`;
  // vírgula e dois-pontos ficam legíveis na URL
  return `${base}?seguir=${ids.map(encodeURIComponent).join(",").replace(/%3A/gi, ":")}`;
}
