import type { ParlamentarResumo, VotoTipo } from "@plenario/core/api";
import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { ApiError } from "../api/client";
import {
  dataNumerica,
  dataTitulo,
  iniciais,
  orgaoNome,
  tempoRelativo,
  VOTO_DESCRICAO,
  VOTO_ROTULO,
} from "../lib/format";
import { useSeguindo } from "../lib/seguindo";
import {
  IconeAbstencao,
  IconeAlerta,
  IconeAusente,
  IconeCheck,
  IconeExterno,
  IconeMais,
  IconeNao,
  IconeObstrucao,
  IconeOutro,
  IconePresidencia,
  IconeSim,
} from "./Icones";

// ---------- Avatar ----------

const TAMANHOS = { sm: "size-9 text-xs", md: "size-11 text-sm", lg: "size-20 text-xl" } as const;

export function Avatar({
  p,
  tamanho = "md",
}: {
  p: Pick<ParlamentarResumo, "nome" | "fotoUrl">;
  tamanho?: keyof typeof TAMANHOS;
}) {
  const [falhou, setFalhou] = useState(false);
  const cls = `${TAMANHOS[tamanho]} shrink-0 rounded-full border border-line bg-sunken object-cover object-top`;
  if (p.fotoUrl && !falhou) {
    return (
      <img
        src={p.fotoUrl}
        alt={`Foto de ${p.nome}`}
        className={cls}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFalhou(true)}
      />
    );
  }
  return (
    <span
      role="img"
      aria-label={`${p.nome} (sem foto)`}
      className={`${cls} grid place-items-center font-semibold tracking-wide text-muted`}
    >
      {iniciais(p.nome)}
    </span>
  );
}

// ---------- Voto ----------

const ICONE_VOTO: Record<VotoTipo, typeof IconeSim> = {
  sim: IconeSim,
  nao: IconeNao,
  abstencao: IconeAbstencao,
  obstrucao: IconeObstrucao,
  art17: IconePresidencia,
  ausente: IconeAusente,
  outro: IconeOutro,
};

/** Voto sempre com ícone + texto, mesma cor para todos (nada de verde/vermelho). */
export function VotoSelo({ voto, compacto = false }: { voto: VotoTipo; compacto?: boolean }) {
  const Icone = ICONE_VOTO[voto];
  return (
    <span
      className={`whitespace-nowrap font-semibold text-ink ${compacto ? "text-sm" : ""}`}
      title={VOTO_DESCRICAO[voto]}
    >
      <Icone tamanho={compacto ? 16 : 17} className="mr-1 inline-block align-[-0.2em]" />
      {VOTO_ROTULO[voto]}
    </span>
  );
}

// ---------- Tempo ----------

/** Tempo relativo; `soData` (hora aproximada na fonte) tira a hora do title. */
export function Tempo({ iso, className = "", soData = false }: { iso: string; className?: string; soData?: boolean }) {
  return (
    <time
      dateTime={iso}
      title={soData ? `Sessão de ${dataNumerica(iso)}` : dataTitulo(iso)}
      className={className}
    >
      {tempoRelativo(iso)}
    </time>
  );
}

// ---------- Órgão ----------

export function Orgao({ codigo }: { codigo: string }) {
  return <span title={`Órgão na fonte: ${codigo}`}>{orgaoNome(codigo)}</span>;
}

// ---------- Link para a fonte ----------

export function FonteLink({
  href,
  children = "Fonte oficial",
  className = "",
}: {
  href: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent ${className}`}
    >
      {children}
      <IconeExterno tamanho={14} />
      <span className="sr-only">(abre em nova aba)</span>
    </a>
  );
}

// ---------- Seguir ----------

export function SeguirBotao({
  id,
  nome,
  tamanho = "md",
}: {
  id: string;
  nome: string;
  tamanho?: "sm" | "md";
}) {
  const { segue, alternar } = useSeguindo();
  const ativo = segue(id);
  const base =
    tamanho === "sm" ? "h-8 px-3 text-sm min-w-[6.5rem]" : "h-10 px-4 text-[15px] min-w-[7.5rem]";
  return (
    <button
      type="button"
      onClick={() => alternar(id)}
      aria-pressed={ativo}
      aria-label={ativo ? `Deixar de seguir ${nome}` : `Seguir ${nome}`}
      className={`group inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border font-semibold transition-colors ${base} ${
        ativo
          ? "border-line-strong bg-surface text-ink hover:border-ink-2"
          : "border-ink bg-ink text-bg hover:bg-ink-2 hover:border-ink-2"
      }`}
    >
      {ativo ? <IconeCheck tamanho={16} /> : <IconeMais tamanho={16} />}
      {ativo ? "Seguindo" : "Seguir"}
    </button>
  );
}

// ---------- Botões ----------

export function Botao({
  children,
  variante = "secundario",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: "primario" | "secundario" }) {
  const v =
    variante === "primario"
      ? "border-ink bg-ink text-bg hover:bg-ink-2"
      : "border-line-strong bg-surface text-ink hover:border-ink-2";
  return (
    <button
      type="button"
      className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg border px-4 text-[15px] font-semibold transition-colors disabled:opacity-50 ${v} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

// ---------- Chips de filtro ----------

export function Chips<T extends string>({
  opcoes,
  valor,
  onChange,
  rotulo,
}: {
  opcoes: { valor: T; rotulo: string }[];
  valor: T;
  onChange: (v: T) => void;
  rotulo: string;
}) {
  return (
    <div role="group" aria-label={rotulo} className="flex gap-2 overflow-x-auto px-4 py-2.5 [scrollbar-width:none]">
      {opcoes.map((o) => {
        const ativo = o.valor === valor;
        return (
          <button
            key={o.valor}
            type="button"
            aria-pressed={ativo}
            onClick={() => onChange(o.valor)}
            className={`h-8 shrink-0 rounded-full border px-3.5 text-sm font-medium transition-colors ${
              ativo
                ? "border-ink bg-ink text-bg"
                : "border-line-strong bg-surface text-ink-2 hover:border-ink-2 hover:text-ink"
            }`}
          >
            {o.rotulo}
          </button>
        );
      })}
    </div>
  );
}

// ---------- Estados ----------

export function mensagemErro(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 400) return "O endereço não corresponde a um registro válido.";
    if (e.status === 404) return e.message || "Não encontrado.";
    return e.message;
  }
  return "Algo deu errado ao carregar os dados.";
}

export function EstadoErro({
  erro,
  tentarDeNovo,
  titulo = "Não foi possível carregar",
}: {
  erro: unknown;
  tentarDeNovo?: () => void;
  titulo?: string;
}) {
  const naoEncontrado = erro instanceof ApiError && (erro.status === 404 || erro.status === 400);
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <IconeAlerta tamanho={28} className="text-muted" />
      <div>
        <p className="font-semibold">{naoEncontrado ? "Não encontrado" : titulo}</p>
        <p className="mt-1 text-sm text-muted">{mensagemErro(erro)}</p>
      </div>
      {tentarDeNovo && !naoEncontrado && <Botao onClick={tentarDeNovo}>Tentar de novo</Botao>}
    </div>
  );
}

export function EstadoVazio({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="font-semibold">{titulo}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Linha({ className = "" }: { className?: string }) {
  return <span className={`skeleton block h-3.5 ${className}`} />;
}

export function CardSkeleton() {
  return (
    <div className="flex gap-3 border-b border-line px-4 py-4" aria-hidden="true">
      <span className="skeleton size-11 shrink-0 rounded-full" />
      <div className="flex-1 space-y-2.5 pt-1">
        <Linha className="w-2/5" />
        <Linha className="w-11/12" />
        <Linha className="w-3/4" />
        <Linha className="w-1/3" />
      </div>
    </div>
  );
}

export function ListaSkeleton({ n = 4 }: { n?: number }) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Carregando…</span>
      {Array.from({ length: n }, (_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}

/** Rótulo pequeno, neutro, com contorno. */
export function Etiqueta({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 rounded border border-line-strong px-1.5 py-px text-xs font-medium text-ink-2"
    >
      {children}
    </span>
  );
}
