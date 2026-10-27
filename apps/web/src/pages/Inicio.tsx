import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { LIMITE_IDS_FEED, useFeed } from "../api/queries";
import { FeedLista, FiltroTipoChips, useFiltroTipo, VazioFiltro } from "../components/FeedLista";
import { IconeBusca } from "../components/Icones";
import { Topo } from "../components/Layout";
import { EstadoVazio } from "../components/ui";
import { UFS } from "../lib/ufs";
import { useSeguindo } from "../lib/seguindo";

function Boasvindas() {
  const navegar = useNavigate();
  const [uf, setUf] = useState("");
  return (
    <section aria-labelledby="boasvindas" className="border-b border-line px-4 py-6">
      <h2 id="boasvindas" className="font-serif text-2xl font-semibold leading-tight tracking-tight">
        Acompanhe o que fazem deputados e senadores
      </h2>
      <p className="mt-2 max-w-prose text-[15px] leading-6 text-ink-2">
        Como votaram, o que propuseram e quanto gastaram da cota parlamentar, em ordem cronológica.
        Só dado oficial, sempre com link para a fonte. Siga quem quiser: a lista fica neste
        navegador, sem cadastro.
      </p>

      <Link
        to="/buscar"
        className="mt-5 flex h-11 items-center gap-2 rounded-lg border border-line-strong bg-bg px-3 text-muted hover:border-ink-2"
      >
        <IconeBusca tamanho={18} />
        Buscar parlamentar pelo nome
      </Link>

      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (uf) navegar(`/buscar?uf=${uf}`);
        }}
      >
        <label className="min-w-0 flex-1 text-sm">
          <span className="mb-1 block text-muted">Ou veja quem representa o seu estado</span>
          <select
            value={uf}
            onChange={(e) => setUf(e.target.value)}
            className="h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-[15px] text-ink"
          >
            <option value="">Escolha a UF</option>
            {UFS.map((u) => (
              <option key={u.sigla} value={u.sigla}>
                {u.nome}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={!uf}
          className="h-11 shrink-0 rounded-lg border border-ink bg-ink px-4 font-semibold text-bg disabled:opacity-40"
        >
          Ver
        </button>
      </form>
    </section>
  );
}

export function Inicio() {
  const { ids } = useSeguindo();
  const [tipo, setTipo, tipos] = useFiltroTipo();
  const segueAlguem = ids.length > 0;
  const query = useFeed(segueAlguem ? ids : undefined, tipos);

  return (
    <>
      <Topo titulo="Início" marca>
        <FiltroTipoChips valor={tipo} onChange={setTipo} />
      </Topo>

      {!segueAlguem && <Boasvindas />}
      {!segueAlguem && (
        <h2 className="px-4 pt-5 pb-1 text-xs font-semibold uppercase tracking-wider text-muted">
          Atividade recente no Congresso
        </h2>
      )}
      {ids.length > LIMITE_IDS_FEED && (
        <p className="border-b border-line bg-warn-soft px-4 py-2 text-sm text-warn-ink">
          Você segue {ids.length} parlamentares; o feed mostra os primeiros {LIMITE_IDS_FEED}.
        </p>
      )}

      <FeedLista
        query={query}
        vazio={
          tipos ? (
            <VazioFiltro />
          ) : (
            <EstadoVazio titulo="Sem atividade recente">
              Quem você segue ainda não tem votos, projetos ou gastos registrados no período.
            </EstadoVazio>
          )
        }
      />
    </>
  );
}
