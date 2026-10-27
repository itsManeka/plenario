import type { Casa } from "@plenario/core/api";
import { useEffect, useId, useState } from "react";
import { useSearchParams } from "react-router";
import { usePartidos, useBuscaParlamentares } from "../api/queries";
import { CarregarMais } from "../components/FeedLista";
import { IconeBusca } from "../components/Icones";
import { Topo } from "../components/Layout";
import { ParlamentarLinha } from "../components/ParlamentarLinha";
import { Botao, EstadoErro, EstadoVazio, Linha } from "../components/ui";
import { plural } from "../lib/format";
import { UFS } from "../lib/ufs";

function useDebounce<T>(valor: T, ms: number): T {
  const [v, setV] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setV(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return v;
}

const seletor =
  "h-10 w-full min-w-0 rounded-lg border border-line-strong bg-surface px-2.5 text-sm text-ink";

function SkeletonLinhas() {
  return (
    <div role="status" aria-hidden="false">
      <span className="sr-only">Carregando…</span>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-line px-4 py-3" aria-hidden="true">
          <span className="skeleton size-11 rounded-full" />
          <div className="flex-1 space-y-2">
            <Linha className="w-1/2" />
            <Linha className="w-1/3" />
          </div>
          <span className="skeleton h-8 w-24 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function Buscar() {
  const [params, setParams] = useSearchParams();
  const casa = (params.get("casa") ?? "") as Casa | "";
  const partido = params.get("partido") ?? "";
  const uf = params.get("uf") ?? "";
  const [texto, setTexto] = useState(params.get("q") ?? "");
  const q = useDebounce(texto, 300);
  const idBusca = useId();

  const atualizar = (chave: string, valor: string) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (valor) n.set(chave, valor);
        else n.delete(chave);
        return n;
      },
      { replace: true },
    );

  useEffect(() => {
    if ((params.get("q") ?? "") !== q.trim()) atualizar("q", q.trim());
  }, [q]);

  const partidos = usePartidos();
  const busca = useBuscaParlamentares({ q, casa, partido, uf });
  const itens = busca.data?.pages.flatMap((p) => p.itens) ?? [];
  const temFiltro = !!(q.trim() || casa || partido || uf);
  const desatualizado = busca.isPlaceholderData || texto !== q;

  return (
    <>
      <Topo titulo="Buscar">
        <div className="px-4 pb-3">
          <form role="search" onSubmit={(e) => e.preventDefault()}>
            <label htmlFor={idBusca} className="sr-only">
              Nome do parlamentar
            </label>
            <div className="relative">
              <IconeBusca
                tamanho={18}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
              />
              <input
                id={idBusca}
                type="search"
                inputMode="search"
                autoComplete="off"
                enterKeyHint="search"
                placeholder="Nome do parlamentar"
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                className="h-11 w-full rounded-lg border border-line-strong bg-bg pr-3 pl-10 text-base text-ink placeholder:text-muted"
              />
            </div>
          </form>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <label className="min-w-0">
              <span className="sr-only">Filtrar por casa</span>
              <select value={casa} onChange={(e) => atualizar("casa", e.target.value)} className={seletor}>
                <option value="">Casa</option>
                <option value="camara">Câmara</option>
                <option value="senado">Senado</option>
              </select>
            </label>
            <label className="min-w-0">
              <span className="sr-only">Filtrar por partido</span>
              <select
                value={partido}
                onChange={(e) => atualizar("partido", e.target.value)}
                className={seletor}
                disabled={partidos.isError}
              >
                <option value="">Partido</option>
                {partidos.data?.map((p) => (
                  <option key={p.sigla} value={p.sigla}>
                    {p.sigla} ({p.total})
                  </option>
                ))}
                {partido && !partidos.data?.some((p) => p.sigla === partido) && (
                  <option value={partido}>{partido}</option>
                )}
              </select>
            </label>
            <label className="min-w-0">
              <span className="sr-only">Filtrar por estado (UF)</span>
              <select value={uf} onChange={(e) => atualizar("uf", e.target.value)} className={seletor}>
                <option value="">UF</option>
                {UFS.map((u) => (
                  <option key={u.sigla} value={u.sigla}>
                    {u.sigla}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </Topo>

      {busca.isPending ? (
        <SkeletonLinhas />
      ) : busca.isError && !busca.isFetchNextPageError ? (
        <EstadoErro erro={busca.error} tentarDeNovo={() => void busca.refetch()} />
      ) : itens.length === 0 ? (
        <EstadoVazio titulo="Ninguém encontrado">
          {temFiltro ? "Confira a grafia ou tire algum filtro." : "Nenhum parlamentar na base ainda."}
        </EstadoVazio>
      ) : (
        <div aria-busy={desatualizado} className={desatualizado ? "opacity-60 transition-opacity" : ""}>
          <p className="px-4 pt-3 pb-1 text-xs text-muted" aria-live="polite">
            {busca.hasNextPage ? `Mais de ${itens.length} resultados` : plural(itens.length, "resultado", "resultados")}
          </p>
          <ul>
            {itens.map((p) => (
              <ParlamentarLinha key={p.id} p={p} />
            ))}
          </ul>
          {busca.isFetchNextPageError ? (
            <div className="flex justify-center py-5">
              <Botao onClick={() => void busca.fetchNextPage()}>Tentar carregar mais</Botao>
            </div>
          ) : (
            <CarregarMais
              temMais={!!busca.hasNextPage}
              carregando={busca.isFetchingNextPage}
              carregar={() => void busca.fetchNextPage()}
            />
          )}
        </div>
      )}
    </>
  );
}
