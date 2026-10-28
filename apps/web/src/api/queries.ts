import type { FeedItemTipo } from "@plenario/core/api";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { api, type FiltroParlamentares } from "./client";

export const LIMITE_IDS_FEED = 200;

export function useFeed(parlamentares: string[] | undefined, tipos: FeedItemTipo[] | undefined) {
  const ids = parlamentares?.slice(0, LIMITE_IDS_FEED);
  return useInfiniteQuery({
    queryKey: ["feed", ids ?? "geral", tipos ?? "todos"],
    queryFn: ({ pageParam, signal }) => api.feed(ids, tipos, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (ultima) => ultima.proximo,
  });
}

export function useFeedParlamentar(id: string, tipos: FeedItemTipo[] | undefined) {
  return useInfiniteQuery({
    queryKey: ["feed-parlamentar", id, tipos ?? "todos"],
    queryFn: ({ pageParam, signal }) => api.feedParlamentar(id, tipos, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (ultima) => ultima.proximo,
  });
}

export function useBuscaParlamentares(f: FiltroParlamentares) {
  return useInfiniteQuery({
    queryKey: ["parlamentares", f.q?.trim() ?? "", f.casa ?? "", f.partido ?? "", f.uf ?? ""],
    queryFn: ({ pageParam, signal }) => api.parlamentares(f, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (ultima) => ultima.proximo,
    placeholderData: keepPreviousData,
  });
}

export function useParlamentar(id: string) {
  return useQuery({
    queryKey: ["parlamentar", id],
    queryFn: ({ signal }) => api.parlamentar(id, signal),
  });
}

/**
 * Resumo de vários parlamentares numa ida só (`?ids=`, até 200 por request).
 * Devolve um Map por id; id ausente do Map = não existe na base.
 */
export function useParlamentaresPorIds(ids: string[]) {
  return useQuery({
    queryKey: ["parlamentares-ids", ids],
    enabled: ids.length > 0,
    staleTime: 10 * 60_000,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      const lotes: string[][] = [];
      for (let i = 0; i < ids.length; i += LIMITE_IDS_FEED) lotes.push(ids.slice(i, i + LIMITE_IDS_FEED));
      const paginas = await Promise.all(lotes.map((l) => api.parlamentaresPorIds(l, signal)));
      return new Map(paginas.flatMap((p) => p.itens).map((p) => [p.id, p] as const));
    },
  });
}

export function useVotacao(id: string) {
  return useQuery({
    queryKey: ["votacao", id],
    queryFn: ({ signal }) => api.votacao(id, signal),
  });
}

export function useProposicao(id: string) {
  return useQuery({
    queryKey: ["proposicao", id],
    queryFn: ({ signal }) => api.proposicao(id, signal),
  });
}

export function usePartidos() {
  return useQuery({
    queryKey: ["partidos"],
    queryFn: ({ signal }) => api.partidos(signal),
    staleTime: 60 * 60_000,
  });
}

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => api.health(signal),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useInfoDados() {
  return useQuery({
    queryKey: ["info-dados"],
    queryFn: ({ signal }) => api.infoDados(signal),
    staleTime: 10 * 60_000,
  });
}
