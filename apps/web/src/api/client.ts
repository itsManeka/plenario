import type {
  Health,
  PartidoResumo,
  FeedItem,
  FeedItemTipo,
  Pagina,
  Parlamentar,
  ParlamentarResumo,
  ProposicaoDetalhe,
  VotacaoDetalhe,
  Casa,
} from "@plenario/core/api";

// Cliente fino sobre o contrato de @plenario/core/api. Em dev, /api passa pelo proxy
// do Vite até apps/api (:8787). VITE_API_URL troca a base (ex.: produção).
// VITE_MOCK=1 responde com fixtures em memória, sem rede.

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "/api";
export const MOCK = import.meta.env.VITE_MOCK === "1";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Params = Record<string, string | number | undefined | null>;

function montarPath(path: string, params?: Params): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v === undefined || v === null || v === "") continue;
    qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

async function get<T>(path: string, params?: Params, signal?: AbortSignal): Promise<T> {
  const alvo = montarPath(path, params);
  if (MOCK) {
    const { responderMock } = await import("./mock");
    return responderMock<T>(alvo, signal);
  }
  let res: Response;
  try {
    res = await fetch(BASE + alvo, { signal, headers: { Accept: "application/json" } });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError("Não foi possível conectar ao servidor. Verifique sua conexão.", 0);
  }
  if (!res.ok) {
    let msg = `Erro ${res.status}`;
    try {
      const corpo = (await res.json()) as { erro?: unknown };
      if (typeof corpo.erro === "string") msg = corpo.erro;
    } catch {
      // corpo não é JSON (ex.: proxy do Vite com a API fora do ar devolve 500 vazio)
      if (res.status >= 500) msg = "O servidor de dados não respondeu. Tente de novo em instantes.";
    }
    throw new ApiError(msg, res.status);
  }
  return (await res.json()) as T;
}

export interface FiltroParlamentares {
  q?: string;
  casa?: Casa | "";
  partido?: string;
  uf?: string;
}

export const api = {
  health: (signal?: AbortSignal) => get<Health>("/health", undefined, signal),

  parlamentares: (f: FiltroParlamentares, cursor?: string | null, signal?: AbortSignal) =>
    get<Pagina<ParlamentarResumo>>(
      "/parlamentares",
      { q: f.q?.trim(), casa: f.casa, partido: f.partido, uf: f.uf, cursor, limite: 30 },
      signal,
    ),

  /** Até 200 ids, na ordem pedida; id inexistente vem omitido. */
  parlamentaresPorIds: (ids: string[], signal?: AbortSignal) =>
    get<Pagina<ParlamentarResumo>>("/parlamentares", { ids: ids.join(",") }, signal),

  parlamentar: (id: string, signal?: AbortSignal) =>
    get<Parlamentar>(`/parlamentares/${encodeURIComponent(id)}`, undefined, signal),

  feedParlamentar: (
    id: string,
    tipos: FeedItemTipo[] | undefined,
    cursor?: string | null,
    signal?: AbortSignal,
  ) =>
    get<Pagina<FeedItem>>(
      `/parlamentares/${encodeURIComponent(id)}/feed`,
      { tipos: tipos?.join(","), cursor },
      signal,
    ),

  feed: (
    parlamentares: string[] | undefined,
    tipos: FeedItemTipo[] | undefined,
    cursor?: string | null,
    signal?: AbortSignal,
  ) =>
    get<Pagina<FeedItem>>(
      "/feed",
      { parlamentares: parlamentares?.join(","), tipos: tipos?.join(","), cursor },
      signal,
    ),

  votacao: (id: string, signal?: AbortSignal) =>
    get<VotacaoDetalhe>(`/votacoes/${encodeURIComponent(id)}`, undefined, signal),

  proposicao: (id: string, signal?: AbortSignal) =>
    get<ProposicaoDetalhe>(`/proposicoes/${encodeURIComponent(id)}`, undefined, signal),

  partidos: (signal?: AbortSignal) =>
    get<PartidoResumo[]>("/partidos", undefined, signal),
};
