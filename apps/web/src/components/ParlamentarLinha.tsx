import type { ParlamentarResumo } from "@plenario/core/api";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { CASA_NOME, partidoUf } from "../lib/format";
import { hrefParlamentar } from "./FeedCard";
import { Avatar, Etiqueta, SeguirBotao } from "./ui";

/** Linha de lista: avatar, nome, partido-UF · cargo, e uma ação à direita (Seguir por padrão). */
export function ParlamentarLinha({ p, acao }: { p: ParlamentarResumo; acao?: ReactNode }) {
  return (
    <li className="relative flex items-center gap-3 border-b border-line px-4 py-3 transition-colors has-[.stretched:hover]:bg-sunken/60 has-[.stretched:focus-visible]:bg-sunken/60">
      <Avatar p={p} />
      <div className="min-w-0 flex-1">
        <Link to={hrefParlamentar(p.id)} className="stretched block truncate font-semibold hover:underline">
          {p.nome}
        </Link>
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-muted">
          <span>
            {partidoUf(p)} · {CASA_NOME[p.casa]}
          </span>
          {!p.emExercicio && <Etiqueta>Fora de exercício</Etiqueta>}
        </p>
      </div>
      <div className="above-stretch">{acao ?? <SeguirBotao id={p.id} nome={p.nome} tamanho="sm" />}</div>
    </li>
  );
}
