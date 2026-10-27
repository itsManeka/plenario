import type { Parlamentar } from "@plenario/core/api";
import { useParams } from "react-router";
import { useFeedParlamentar, useParlamentar } from "../api/queries";
import { FeedLista, FiltroTipoChips, useFiltroTipo, VazioFiltro } from "../components/FeedLista";
import { Topo } from "../components/Layout";
import { Avatar, EstadoErro, EstadoVazio, Etiqueta, FonteLink, Linha, SeguirBotao } from "../components/ui";
import { brlInteiro, CASA_CARGO, num, partidoUf, pct } from "../lib/format";

function Estatistica({ rotulo, valor, nota }: { rotulo: string; valor: string; nota?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-line px-3 py-2.5">
      <dt className="text-xs leading-4 text-muted">{rotulo}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums leading-6">{valor}</dd>
      {nota && <dd className="text-xs leading-4 text-muted">{nota}</dd>}
    </div>
  );
}

function Cabecalho({ p }: { p: Parlamentar }) {
  const e = p.estatisticas;
  const ano = new Date().getFullYear();
  return (
    <section aria-label="Dados do parlamentar" className="border-b border-line px-4 pt-5 pb-4">
      <div className="flex items-start gap-4">
        <Avatar p={p} tamanho="lg" />
        <div className="min-w-0 flex-1 pt-1">
          <h2 className="font-serif text-2xl font-semibold leading-tight tracking-tight">{p.nome}</h2>
          <p className="mt-1 text-[15px] text-ink-2">
            {CASA_CARGO[p.casa]} · {partidoUf(p)}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Etiqueta>{p.emExercicio ? "Em exercício" : "Fora de exercício"}</Etiqueta>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <SeguirBotao id={p.id} nome={p.nome} />
        <FonteLink href={p.urlOficial} className="text-sm">
          Página oficial
        </FonteLink>
        {p.email && (
          <a href={`mailto:${p.email}`} className="text-sm text-accent underline decoration-accent/40 underline-offset-2">
            {p.email}
          </a>
        )}
      </div>
      {p.nomeCivil && p.nomeCivil !== p.nome && (
        <p className="mt-3 text-sm text-muted">Nome civil: {p.nomeCivil}</p>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Estatistica
          rotulo="Votações nominais"
          valor={num(e.votacoesNominais)}
          nota="na legislatura"
        />
        <Estatistica
          rotulo="Participação"
          valor={e.presencaPct === null ? "—" : pct(e.presencaPct)}
          nota="nas votações nominais em que estava no cargo"
        />
        <Estatistica rotulo="Proposições" valor={num(e.proposicoesAutor)} nota="como autor(a)" />
        <Estatistica
          rotulo={`Cota parlamentar ${ano}`}
          valor={e.despesasAnoCorrente === null ? "—" : brlInteiro(e.despesasAnoCorrente)}
          nota={e.despesasAnoCorrente === null ? "sem dados do Senado ainda" : "gasto no ano"}
        />
      </dl>
    </section>
  );
}

function CabecalhoSkeleton() {
  return (
    <div className="border-b border-line px-4 pt-5 pb-4" role="status">
      <span className="sr-only">Carregando…</span>
      <div className="flex items-start gap-4" aria-hidden="true">
        <span className="skeleton size-20 rounded-full" />
        <div className="flex-1 space-y-2.5 pt-2">
          <Linha className="h-5 w-3/5" />
          <Linha className="w-2/5" />
          <Linha className="w-1/4" />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <span key={i} className="skeleton h-[74px] rounded-lg" />
        ))}
      </div>
    </div>
  );
}

function FeedDoParlamentar({ id }: { id: string }) {
  const [tipo, setTipo, tipos] = useFiltroTipo();
  const query = useFeedParlamentar(id, tipos);
  return (
    <section aria-label="Atividades">
      <div className="sticky top-14 z-10 border-b border-line bg-surface/95 backdrop-blur">
        <FiltroTipoChips valor={tipo} onChange={setTipo} />
      </div>
      <FeedLista
        query={query}
        vazio={
          tipos ? (
            <VazioFiltro />
          ) : (
            <EstadoVazio titulo="Sem atividade registrada">Nada no período coberto pela base.</EstadoVazio>
          )
        }
      />
    </section>
  );
}

export function Perfil() {
  const { id = "" } = useParams();
  const q = useParlamentar(id);

  return (
    <>
      <Topo titulo={q.data?.nome ?? "Parlamentar"} voltar />
      {q.isPending ? (
        <CabecalhoSkeleton />
      ) : q.isError ? (
        <EstadoErro erro={q.error} tentarDeNovo={() => void q.refetch()} />
      ) : (
        <>
          <title>{`${q.data.nome} · Plenário`}</title>
          <Cabecalho p={q.data} />
        </>
      )}
      {!q.isError && <FeedDoParlamentar id={id} />}
    </>
  );
}
