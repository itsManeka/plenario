import { useEffect, type ReactNode } from "react";
import { Link, NavLink, Outlet, ScrollRestoration, useLocation, useNavigate } from "react-router";
import { MOCK } from "../api/client";
import { useSeguindo } from "../lib/seguindo";
import { IconeBusca, IconeInicio, IconePredio, IconeSeguindo, IconeVoltar } from "./Icones";

const NAV = [
  { to: "/", rotulo: "Início", Icone: IconeInicio, end: true },
  { to: "/buscar", rotulo: "Buscar", Icone: IconeBusca, end: false },
  { to: "/seguindo", rotulo: "Seguindo", Icone: IconeSeguindo, end: false },
] as const;

function Marca({ className = "" }: { className?: string }) {
  return (
    <Link to="/" className={`inline-flex items-center gap-2 rounded-md ${className}`}>
      <span className="grid size-8 place-items-center rounded-lg bg-ink text-bg">
        <IconePredio tamanho={18} />
      </span>
      <span className="font-serif text-xl font-semibold tracking-tight">Plenário</span>
    </Link>
  );
}

function ContagemSeguindo() {
  const { ids } = useSeguindo();
  if (!ids.length) return null;
  return (
    <span className="ml-auto rounded-full bg-sunken px-2 text-xs font-semibold tabular-nums text-muted">
      {ids.length}
      <span className="sr-only"> parlamentares</span>
    </span>
  );
}

export function Layout() {
  const local = useLocation();
  const navegar = useNavigate();

  // Link compartilhado (?seguir=a,b) em qualquer rota abre a importação em /seguindo.
  useEffect(() => {
    const p = new URLSearchParams(local.search);
    if (p.has("seguir") && local.pathname !== "/seguindo") {
      navegar(`/seguindo?seguir=${p.get("seguir") ?? ""}`, { replace: true });
    }
  }, [local.pathname, local.search, navegar]);

  return (
    <div className="min-h-dvh">
      <a
        href="#conteudo"
        className="sr-only z-50 rounded-md bg-ink px-4 py-2 text-bg focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Pular para o conteúdo
      </a>

      <div className="mx-auto flex max-w-[1040px] justify-center md:px-4">
        {/* Navegação lateral (tablet/desktop) */}
        <header className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col gap-6 py-5 pr-4 md:flex lg:w-64">
          <Marca className="px-2" />
          <nav aria-label="Principal">
            <ul className="space-y-1">
              {NAV.map(({ to, rotulo, Icone, end }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    end={end}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] transition-colors hover:bg-sunken ${
                        isActive ? "font-semibold text-ink" : "text-ink-2"
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Icone tamanho={22} strokeWidth={isActive ? 2.25 : 1.75} />
                        {rotulo}
                        {to === "/seguindo" && <ContagemSeguindo />}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <div className="mt-auto space-y-2 px-3 text-xs leading-5 text-muted">
            <p>
              Dados oficiais da Câmara dos Deputados e do Senado Federal. Projeto aberto e sem fins
              lucrativos. Quem você segue fica só neste navegador.
            </p>
            <p className="flex flex-wrap gap-x-3">
              <Link to="/sobre" className="underline underline-offset-2 hover:text-ink">
                Sobre e fontes
              </Link>
              <a
                href="https://github.com/tonhonho/plenario"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-ink"
              >
                Código no GitHub
              </a>
            </p>
          </div>
        </header>

        <div className="min-w-0 max-w-[640px] flex-1 border-line bg-surface md:border-x">
          {MOCK && (
            <p className="border-b border-line bg-warn-soft px-4 py-1.5 text-center text-xs font-medium text-warn-ink">
              Modo de demonstração: dados fictícios (VITE_MOCK=1)
            </p>
          )}
          <main id="conteudo" tabIndex={-1} className="min-h-dvh pb-20 outline-none md:pb-8">
            <Outlet />
          </main>
        </div>
      </div>

      {/* Barra inferior (celular) */}
      <nav
        aria-label="Principal"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <ul className="mx-auto flex max-w-[640px]">
          {NAV.map(({ to, rotulo, Icone, end }) => (
            <li key={to} className="flex-1">
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] ${
                    isActive ? "font-semibold text-ink" : "text-muted"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icone tamanho={22} strokeWidth={isActive ? 2.25 : 1.75} />
                    {rotulo}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <ScrollRestoration />
    </div>
  );
}

/** Barra de título da página, fixa no topo da coluna. */
export function Topo({
  titulo,
  voltar = false,
  children,
  marca = false,
  acao,
}: {
  titulo: ReactNode;
  voltar?: boolean;
  children?: ReactNode;
  marca?: boolean;
  /** Elemento à direita da barra (ex.: link "Sobre" no celular). */
  acao?: ReactNode;
}) {
  const navegar = useNavigate();
  const local = useLocation();
  // sem histórico dentro do app (link aberto direto): voltar leva ao início
  const temHistorico = local.key !== "default";
  return (
    <div className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
      <div className="flex h-14 items-center gap-2 px-4">
        {voltar && (
          <button
            type="button"
            onClick={() => (temHistorico ? navegar(-1) : navegar("/"))}
            className="-ml-2 grid size-9 place-items-center rounded-full hover:bg-sunken"
            aria-label="Voltar"
          >
            <IconeVoltar tamanho={22} />
          </button>
        )}
        {marca ? (
          <>
            <Marca className="md:hidden" />
            <h1 className="sr-only md:not-sr-only md:text-lg md:font-semibold">{titulo}</h1>
          </>
        ) : (
          <h1 className="min-w-0 truncate text-lg font-semibold">{titulo}</h1>
        )}
        {acao && <div className="ml-auto">{acao}</div>}
      </div>
      {children}
    </div>
  );
}
