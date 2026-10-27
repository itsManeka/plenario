import type { FeedItem, Pagina } from "@plenario/core/api";
import { normalizarBusca } from "@plenario/core/texto";
import { ApiError } from "../client";
import { feed, parlamentares, partidos, proposicoes, resumo, votacoes } from "./fixtures";

// Implementa as rotas de packages/core/src/api.ts sobre as fixtures, com latência
// artificial. Ids contendo "erro" devolvem 500, para ver os estados de erro.

const PAGINA = 30;

function paginar<T>(lista: T[], cursor: string | null, limite = PAGINA): Pagina<T> {
  const inicio = cursor ? Number(cursor) || 0 : 0;
  const itens = lista.slice(inicio, inicio + limite);
  const fim = inicio + itens.length;
  return { itens, proximo: fim < lista.length ? String(fim) : null };
}

function esperar(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("abortado", "AbortError"));
    });
  });
}

function filtrarFeed(lista: FeedItem[], q: URLSearchParams): FeedItem[] {
  const tipos = q.get("tipos")?.split(",").filter(Boolean);
  const ids = q.get("parlamentares")?.split(",").filter(Boolean);
  return lista.filter(
    (f) => (!tipos?.length || tipos.includes(f.tipo)) && (!ids?.length || ids.includes(f.parlamentar.id)),
  );
}

function rotear(path: string, q: URLSearchParams): unknown {
  const partes = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (partes.some((p) => p.includes("erro"))) throw new ApiError("Falha simulada no servidor.", 500);

  const [raiz, id, sub] = partes;
  switch (raiz) {
    case "health":
      return { ok: true, versao: "mock", dadosAte: feed[0]?.ocorridoEm ?? null };
    case "partidos":
      return partidos;
    case "feed":
      return paginar(filtrarFeed(feed, q), q.get("cursor"));
    case "parlamentares": {
      if (!id && q.get("ids") !== null) {
        // ?ids= ignora os outros filtros, devolve na ordem pedida e omite id inexistente
        const pedidos = (q.get("ids") ?? "").split(",").filter(Boolean).slice(0, 200);
        if (pedidos.some((x) => x.includes("erro"))) throw new ApiError("Falha simulada no servidor.", 500);
        const itens = pedidos.flatMap((x) => {
          const p = parlamentares.find((y) => y.id === x);
          return p ? [resumo(p)] : [];
        });
        return { itens, proximo: null };
      }
      if (!id) {
        const termo = normalizarBusca(q.get("q"));
        const casa = q.get("casa");
        const partido = q.get("partido");
        const uf = q.get("uf");
        const limite = Math.min(Number(q.get("limite")) || PAGINA, 100);
        const lista = parlamentares
          .filter(
            (p) =>
              (!termo || normalizarBusca(p.nome, p.nomeCivil).includes(termo)) &&
              (!casa || p.casa === casa) &&
              (!partido || p.partido === partido) &&
              (!uf || p.uf === uf),
          )
          .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
          .map(resumo);
        return paginar(lista, q.get("cursor"), limite);
      }
      const p = parlamentares.find((x) => x.id === id);
      if (!p) throw new ApiError("Parlamentar não encontrado.", 404);
      if (sub === "feed") {
        q.set("parlamentares", id);
        return paginar(filtrarFeed(feed, q), q.get("cursor"));
      }
      return p;
    }
    case "votacoes": {
      const v = votacoes.find((x) => x.id === id);
      if (!v) throw new ApiError("Votação não encontrada.", 404);
      return v;
    }
    case "proposicoes": {
      const p = proposicoes.find((x) => x.id === id);
      if (!p) throw new ApiError("Proposição não encontrada.", 404);
      return p;
    }
  }
  throw new ApiError("Rota não encontrada.", 404);
}

export async function responderMock<T>(alvo: string, signal?: AbortSignal): Promise<T> {
  const url = new URL(alvo, "http://mock");
  await esperar(250 + Math.random() * 400, signal);
  // structuredClone: a tela nunca recebe referência viva das fixtures
  return structuredClone(rotear(url.pathname, url.searchParams)) as T;
}
