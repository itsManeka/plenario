import type { VotacaoDetalhe, VotoTipo } from "@plenario/core/api";
import { useDeferredValue, useId, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { useVotacao } from "../api/queries";
import { hrefParlamentar, hrefProposicao } from "../components/FeedCard";
import { IconeBusca, IconeNao, IconeSim } from "../components/Icones";
import { Topo } from "../components/Layout";
import { Avatar, Chips, EstadoErro, EstadoVazio, Etiqueta, FonteLink, Linha, Orgao, VotoSelo } from "../components/ui";
import { CASA_NOME, normalizar, notaQuorum, num, partidoUf, plural, quandoVotacao } from "../lib/format";
import { useSeguindo } from "../lib/seguindo";

type FiltroVoto = "todos" | "sim" | "nao" | "outros" | "seguindo";

function Placar({ v }: { v: VotacaoDetalhe }) {
  if (!v.placar) return null;
  const { sim, nao, outros } = v.placar;
  const total = sim + nao + outros || 1;
  return (
    <div className="mt-4">
      <dl className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border border-line py-2">
          <dt className="flex items-center justify-center gap-1 text-sm text-ink-2">
            <IconeSim tamanho={16} /> Sim
          </dt>
          <dd className="text-2xl font-semibold tabular-nums">{num(sim)}</dd>
        </div>
        <div className="rounded-lg border border-line py-2">
          <dt className="flex items-center justify-center gap-1 text-sm text-ink-2">
            <IconeNao tamanho={16} /> Não
          </dt>
          <dd className="text-2xl font-semibold tabular-nums">{num(nao)}</dd>
        </div>
        <div className="rounded-lg border border-line py-2">
          <dt className="text-sm text-ink-2" title="Abstenção, obstrução e outros registros">
            Outros
          </dt>
          <dd className="text-2xl font-semibold tabular-nums">{num(outros)}</dd>
        </div>
      </dl>
      {/* barra neutra: dois tons de cinza + rótulos acima; nada de verde/vermelho */}
      <div aria-hidden="true" className="mt-2 flex h-2 overflow-hidden rounded-full bg-sunken">
        <span className="bg-ink" style={{ width: `${(sim / total) * 100}%` }} />
        <span className="w-0.5 bg-surface" />
        <span className="bg-muted/60" style={{ width: `${(nao / total) * 100}%` }} />
      </div>
    </div>
  );
}

function PorPartido({ v }: { v: VotacaoDetalhe }) {
  if (!v.porPartido.length) return null;
  const linhas = [...v.porPartido].sort(
    (a, b) => b.sim + b.nao + b.outros - (a.sim + a.nao + a.outros) || a.partido.localeCompare(b.partido),
  );
  return (
    <section aria-labelledby="por-partido" className="border-b border-line px-4 py-5">
      <h2 id="por-partido" className="text-base font-semibold">
        Votos por partido
      </h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <caption className="sr-only">Quantidade de votos sim, não e outros por partido</caption>
          <thead>
            <tr className="border-b border-line text-left text-muted">
              <th scope="col" className="py-2 pr-2 font-medium">
                Partido
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium">
                Sim
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium">
                Não
              </th>
              <th scope="col" className="py-2 pl-2 text-right font-medium">
                Outros
              </th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.partido} className="border-b border-line last:border-0">
                <th scope="row" className="py-2 pr-2 text-left font-semibold">
                  {l.partido}
                </th>
                <td className="px-2 py-2 text-right">{num(l.sim)}</td>
                <td className="px-2 py-2 text-right">{num(l.nao)}</td>
                <td className="py-2 pl-2 text-right">{num(l.outros)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function grupo(v: VotoTipo): "sim" | "nao" | "outros" {
  return v === "sim" ? "sim" : v === "nao" ? "nao" : "outros";
}

function ListaVotos({ v }: { v: VotacaoDetalhe }) {
  const { ids } = useSeguindo();
  const [texto, setTexto] = useState("");
  const [filtro, setFiltro] = useState<FiltroVoto>("todos");
  const termo = normalizar(useDeferredValue(texto));
  const idBusca = useId();

  const indexados = useMemo(
    () =>
      v.votos
        .map((x) => ({
          ...x,
          chave: normalizar(`${x.parlamentar.nome} ${x.parlamentar.partido ?? ""} ${x.parlamentar.uf ?? ""}`),
        }))
        .sort((a, b) => a.parlamentar.nome.localeCompare(b.parlamentar.nome, "pt-BR")),
    [v.votos],
  );

  const visiveis = indexados.filter(
    (x) =>
      (!termo || x.chave.includes(termo)) &&
      (filtro === "todos" ||
        (filtro === "seguindo" ? ids.includes(x.parlamentar.id) : grupo(x.voto) === filtro)),
  );

  const opcoes: { valor: FiltroVoto; rotulo: string }[] = [
    { valor: "todos", rotulo: `Todos (${v.votos.length})` },
    { valor: "sim", rotulo: "Sim" },
    { valor: "nao", rotulo: "Não" },
    { valor: "outros", rotulo: "Outros" },
  ];
  if (ids.length) opcoes.push({ valor: "seguindo", rotulo: "Quem eu sigo" });

  return (
    <section aria-labelledby="votos">
      <div className="px-4 pt-5">
        <h2 id="votos" className="text-base font-semibold">
          Como cada um votou
        </h2>
        <label htmlFor={idBusca} className="sr-only">
          Filtrar por nome, partido ou UF
        </label>
        <div className="relative mt-3">
          <IconeBusca
            tamanho={18}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            id={idBusca}
            type="search"
            autoComplete="off"
            placeholder="Filtrar por nome, partido ou UF"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            className="h-10 w-full rounded-lg border border-line-strong bg-bg pr-3 pl-10 text-base text-ink placeholder:text-muted"
          />
        </div>
      </div>
      <div className="-mt-0.5">
        <Chips rotulo="Filtrar por voto" opcoes={opcoes} valor={filtro} onChange={setFiltro} />
      </div>
      <p className="px-4 pb-1 text-xs text-muted" aria-live="polite">
        {plural(visiveis.length, "parlamentar", "parlamentares")}
      </p>
      {visiveis.length === 0 ? (
        <EstadoVazio titulo="Ninguém com esse filtro" />
      ) : (
        <ul>
          {visiveis.map(({ parlamentar: p, voto }) => (
            <li
              key={p.id}
              className="relative flex items-center gap-3 border-t border-line px-4 py-2.5 has-[.stretched:hover]:bg-sunken/60 has-[.stretched:focus-visible]:bg-sunken/60"
            >
              <Avatar p={p} tamanho="sm" />
              <div className="min-w-0 flex-1">
                <Link to={hrefParlamentar(p.id)} className="stretched block truncate text-[15px] font-medium hover:underline">
                  {p.nome}
                </Link>
                <p className="text-xs text-muted">{partidoUf(p)}</p>
              </div>
              <VotoSelo voto={voto} compacto />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Skeleton() {
  return (
    <div className="px-4 py-5" role="status">
      <span className="sr-only">Carregando…</span>
      <div className="space-y-3" aria-hidden="true">
        <Linha className="w-1/3" />
        <Linha className="h-6 w-4/5" />
        <Linha className="w-full" />
        <Linha className="w-2/3" />
        <div className="grid grid-cols-3 gap-2 pt-2">
          <span className="skeleton h-16 rounded-lg" />
          <span className="skeleton h-16 rounded-lg" />
          <span className="skeleton h-16 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

export function Votacao() {
  const { id = "" } = useParams();
  const q = useVotacao(id);

  if (q.isPending)
    return (
      <>
        <Topo titulo="Votação" voltar />
        <Skeleton />
      </>
    );
  if (q.isError)
    return (
      <>
        <Topo titulo="Votação" voltar />
        <EstadoErro erro={q.error} tentarDeNovo={() => void q.refetch()} />
      </>
    );

  const v = q.data;
  const titulo = v.proposicao?.rotulo ?? v.descricao ?? "Votação nominal";
  const resultado = v.aprovada === null ? "Sem resultado registrado" : v.aprovada ? "Aprovada" : "Rejeitada";
  const urlOficial = v.urlOficial ?? v.proposicao?.url ?? null;
  const nota = notaQuorum(v);
  const modalidade = v.secreta
    ? "Votação secreta: o placar é público, o voto individual não."
    : !v.nominal
      ? "Votação simbólica: sem registro de voto individual."
      : null;

  return (
    <>
      <title>{`Votação: ${titulo} · Plenário`}</title>
      <Topo titulo="Votação" voltar />
      <article>
        <section className="border-b border-line px-4 py-5">
          <p className="text-sm text-muted">
            {CASA_NOME[v.casa]}
            {v.orgao && (
              <>
                {" · "}
                <Orgao codigo={v.orgao} />
              </>
            )}
          </p>
          <p className="text-sm text-muted">
            <time
              dateTime={v.dataHora}
              title={v.dataHoraAproximada ? "A fonte informa só o início da sessão, não a hora desta votação" : undefined}
            >
              {quandoVotacao(v)}
            </time>
          </p>
          <h2 className="mt-2 font-serif text-2xl font-semibold leading-tight tracking-tight">{titulo}</h2>
          {v.proposicao && v.descricao && <p className="mt-2 text-[15px] text-ink-2">{v.descricao}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Etiqueta>{resultado}</Etiqueta>
          </div>
          {modalidade && (
            <p className="mt-2 text-sm text-ink-2">
              {modalidade}
            </p>
          )}
          <Placar v={v} />
          {nota && <p className="mt-2 text-sm text-muted">{nota}.</p>}
          {urlOficial && (
            <p className="mt-4 text-sm">
              <FonteLink href={urlOficial}>Ver na página oficial</FonteLink>
            </p>
          )}
        </section>

        {v.proposicao && (
          <section aria-labelledby="prop" className="border-b border-line px-4 py-5">
            <h2 id="prop" className="text-xs font-semibold uppercase tracking-wider text-muted">
              Proposição votada
            </h2>
            <div className="relative mt-2 rounded-lg border border-line p-3 has-[.stretched:hover]:bg-sunken/60 has-[.stretched:focus-visible]:bg-sunken/60">
              <Link to={hrefProposicao(v.proposicao.id)} className="stretched font-semibold hover:underline">
                {v.proposicao.rotulo}
              </Link>
              {v.proposicao.ementa && <p className="mt-1 text-sm leading-5 text-ink-2">{v.proposicao.ementa}</p>}
            </div>
          </section>
        )}

        <PorPartido v={v} />
        {v.votos.length > 0 ? (
          <ListaVotos v={v} />
        ) : (
          <EstadoVazio titulo="Sem votos individuais">
            {v.secreta
              ? "Em votação secreta só o placar é divulgado."
              : !v.nominal
                ? "Em votação simbólica não há registro de como cada parlamentar votou."
                : "A fonte ainda não publicou os votos desta votação."}
          </EstadoVazio>
        )}
      </article>
    </>
  );
}
