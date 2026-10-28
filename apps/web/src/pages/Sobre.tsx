import { Link } from "react-router";
import { useInfoDados } from "../api/queries";
import { Topo } from "../components/Layout";
import { EstadoErro, FonteLink, Linha } from "../components/ui";
import { dataExtenso, dataHora } from "../lib/format";

export const REPOSITORIO = "https://github.com/tonhonho/plenario";

const FONTES = [
  { nome: "Dados Abertos da Câmara dos Deputados", url: "https://dadosabertos.camara.leg.br/" },
  { nome: "Dados Abertos do Senado Federal", url: "https://www12.senado.leg.br/dados-abertos" },
  { nome: "Cota parlamentar (CEAP) da Câmara", url: "https://www.camara.leg.br/transparencia/gastos-parlamentares" },
];

function DataDosDados() {
  const q = useInfoDados();
  if (q.isPending)
    return (
      <div className="space-y-2" role="status">
        <span className="sr-only">Carregando…</span>
        <Linha className="w-2/3" />
        <Linha className="w-1/2" />
      </div>
    );
  if (q.isError) return <EstadoErro erro={q.error} tentarDeNovo={() => void q.refetch()} />;
  const { dadosAte, geradoEm } = q.data;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[15px]">
      <dt className="text-muted">Atividade mais recente</dt>
      <dd>{dadosAte ? <time dateTime={dadosAte}>{dataExtenso(dadosAte)}</time> : "—"}</dd>
      {geradoEm && (
        <>
          <dt className="text-muted">Arquivos gerados em</dt>
          <dd>
            <time dateTime={geradoEm}>{dataHora(geradoEm)}</time>
          </dd>
        </>
      )}
    </dl>
  );
}

export function Sobre() {
  return (
    <>
      <title>Sobre · Plenário</title>
      <Topo titulo="Sobre" voltar />
      <article className="space-y-8 px-4 py-6 text-[15px] leading-6">
        <section>
          <h2 className="font-serif text-2xl font-semibold leading-tight tracking-tight">O que é o Plenário</h2>
          <p className="mt-2 text-ink-2">
            Consulta pública da atuação de deputados federais e senadores: como votaram, o que
            propuseram e quanto gastaram da cota parlamentar. O projeto não classifica, não
            pontua e não julga votos. Mostra o fato, sempre com link para a página oficial.
          </p>
          <p className="mt-2 text-ink-2">
            Não há conta nem cadastro. Quem você segue fica guardado só neste navegador.
          </p>
        </section>

        <section aria-labelledby="atualizacao">
          <h2 id="atualizacao" className="text-base font-semibold">
            Atualização dos dados
          </h2>
          <div className="mt-2">
            <DataDosDados />
          </div>
        </section>

        <section aria-labelledby="fontes">
          <h2 id="fontes" className="text-base font-semibold">
            Fontes oficiais
          </h2>
          <ul className="mt-2 space-y-1.5">
            {FONTES.map((f) => (
              <li key={f.url}>
                <FonteLink href={f.url}>{f.nome}</FonteLink>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="limites">
          <h2 id="limites" className="text-base font-semibold">
            Limitações conhecidas
          </h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-ink-2">
            <li>
              Os dados abertos da Câmara não trazem passagens aéreas desde agosto de 2025. Por
              isso, os totais da cota a partir desse mês ficam abaixo dos da página oficial.
            </li>
            <li>Gastos da cota do Senado ainda não estão incluídos.</li>
            <li>
              Votação simbólica não tem registro de voto individual, e votação secreta só tem o
              placar. Por isso nenhuma das duas aparece no feed de quem você segue.
            </li>
          </ul>
        </section>

        <section aria-labelledby="codigo">
          <h2 id="codigo" className="text-base font-semibold">
            Código aberto
          </h2>
          <p className="mt-2 text-ink-2">
            Projeto sem fins lucrativos, sob licença AGPL-3.0. Correções e sugestões são bem-vindas.
          </p>
          <p className="mt-2">
            <FonteLink href={REPOSITORIO}>Repositório no GitHub</FonteLink>
          </p>
        </section>

        <p className="text-sm text-muted">
          <Link to="/" className="text-accent underline underline-offset-2">
            Voltar ao início
          </Link>
        </p>
      </article>
    </>
  );
}
