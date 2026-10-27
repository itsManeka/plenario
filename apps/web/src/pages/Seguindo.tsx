import type { ParlamentarResumo } from "@plenario/core/api";
import { useId, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useParlamentaresPorIds } from "../api/queries";
import { IconeBaixar, IconeLink, IconeSubir } from "../components/Icones";
import { Topo } from "../components/Layout";
import { ParlamentarLinha } from "../components/ParlamentarLinha";
import { Avatar, Botao, EstadoErro, EstadoVazio, Linha, mensagemErro } from "../components/ui";
import { CASA_CARGO, partidoUf, plural } from "../lib/format";
import {
  idsDoParametro,
  lerImportacao,
  linkCompartilhavel,
  paraArquivo,
  storageDisponivel,
  useSeguindo,
} from "../lib/seguindo";

function LinhaCarregando() {
  return (
    <li className="flex items-center gap-3 border-b border-line px-4 py-3" aria-hidden="true">
      <span className="skeleton size-11 rounded-full" />
      <div className="flex-1 space-y-2">
        <Linha className="w-1/2" />
        <Linha className="w-1/3" />
      </div>
    </li>
  );
}

/** Lista compartilhada por link (?seguir=a,b): pré-visualiza e pede confirmação. */
function ImportarDoLink({ ids, fechar }: { ids: string[]; fechar: () => void }) {
  const { ids: atuais, adicionarVarios, substituir } = useSeguindo();
  const consulta = useParlamentaresPorIds(ids.slice(0, 50));
  const resolvido = consulta.data && !consulta.isPlaceholderData;
  // depois de consultar, id que não existe na base não entra na lista
  const validos = resolvido && ids.length <= 50 ? ids.filter((id) => consulta.data?.has(id)) : ids;
  const novos = validos.filter((id) => !atuais.includes(id));
  const [feito, setFeito] = useState<string | null>(null);

  return (
    <section
      aria-labelledby="importar-link"
      className="border-b border-line bg-accent-soft/60 px-4 py-4"
    >
      <h2 id="importar-link" className="font-semibold">
        Lista compartilhada com {plural(ids.length, "parlamentar", "parlamentares")}
      </h2>
      {feito ? (
        <div role="status" className="mt-2 text-sm">
          <p>{feito}</p>
          <Botao className="mt-3" onClick={fechar}>
            Fechar
          </Botao>
        </div>
      ) : (
        <>
          <p className="mt-1 text-sm text-ink-2">
            {novos.length === 0
              ? "Você já segue todos desta lista."
              : `${plural(novos.length, "não está", "não estão")} na sua lista.`}
          </p>
          <ul className="mt-3 flex flex-wrap gap-2" aria-label="Parlamentares da lista">
            {ids.slice(0, 50).map((id) => {
              const p = consulta.data?.get(id);
              return (
                <li
                  key={id}
                  className="flex items-center gap-2 rounded-full border border-line bg-surface py-1 pr-3 pl-1 text-sm"
                >
                  {p ? (
                    <>
                      <Avatar p={p} tamanho="sm" />
                      <span>
                        {p.nome} <span className="text-muted">({partidoUf(p)})</span>
                      </span>
                    </>
                  ) : resolvido || consulta.isError ? (
                    <span className="pl-2 text-muted">
                      {id} ({consulta.isError ? mensagemErro(consulta.error) : "não encontrado"})
                    </span>
                  ) : (
                    <span className="skeleton ml-1 h-4 w-28" />
                  )}
                </li>
              );
            })}
            {ids.length > 50 && <li className="self-center text-sm text-muted">e mais {ids.length - 50}</li>}
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            {novos.length > 0 && (
              <Botao
                variante="primario"
                onClick={() => {
                  const n = adicionarVarios(validos);
                  setFeito(`${plural(n, "parlamentar adicionado", "parlamentares adicionados")} à sua lista.`);
                }}
              >
                Adicionar à minha lista
              </Botao>
            )}
            {atuais.length > 0 && (
              <Botao
                onClick={() => {
                  substituir(validos);
                  setFeito("Sua lista foi substituída pela lista compartilhada.");
                }}
              >
                Substituir minha lista
              </Botao>
            )}
            <Botao onClick={fechar}>{novos.length ? "Agora não" : "Fechar"}</Botao>
          </div>
        </>
      )}
    </section>
  );
}

function ExportarImportar({ ids }: { ids: string[] }) {
  const { adicionarVarios } = useSeguindo();
  const [aviso, setAviso] = useState<string | null>(null);
  const [colado, setColado] = useState("");
  const arquivoRef = useRef<HTMLInputElement>(null);
  const idCampo = useId();

  const link = ids.length ? linkCompartilhavel(ids) : "";

  async function copiarLink() {
    try {
      await navigator.clipboard.writeText(link);
      setAviso("Link copiado. Quem abrir verá a lista e poderá adicioná-la.");
    } catch {
      setAviso("Não foi possível copiar automaticamente. Selecione o link abaixo e copie.");
    }
  }

  function baixar() {
    const blob = new Blob([JSON.stringify(paraArquivo(ids), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "plenario-seguindo.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function importar(texto: string, origem: string) {
    const lidos = lerImportacao(texto);
    if (!lidos.length) {
      setAviso(`Nenhum parlamentar válido encontrado no ${origem}.`);
      return;
    }
    const n = adicionarVarios(lidos);
    setAviso(
      n
        ? `${plural(n, "parlamentar adicionado", "parlamentares adicionados")} (de ${lidos.length} no ${origem}).`
        : `Você já seguia todos os ${lidos.length} do ${origem}.`,
    );
    setColado("");
  }

  return (
    <section aria-labelledby="levar" className="px-4 py-6">
      <h2 id="levar" className="text-base font-semibold">
        Levar a lista para outro lugar
      </h2>
      <p className="mt-1 text-sm text-muted">
        Sem conta, a lista existe só neste navegador. Para usá-la em outro aparelho ou mandar para
        alguém, exporte e importe.
      </p>

      {ids.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Botao onClick={() => void copiarLink()}>
            <IconeLink tamanho={18} /> Copiar link da lista
          </Botao>
          <Botao onClick={baixar}>
            <IconeBaixar tamanho={18} /> Baixar arquivo (.json)
          </Botao>
        </div>
      )}
      {link && (
        <input
          readOnly
          aria-label="Link compartilhável da lista"
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          className="mt-3 h-9 w-full truncate rounded-md border border-line bg-bg px-2 font-mono text-xs text-ink-2"
        />
      )}

      <div className="mt-5">
        <Botao onClick={() => arquivoRef.current?.click()}>
          <IconeSubir tamanho={18} /> Importar arquivo
        </Botao>
        <input
          ref={arquivoRef}
          type="file"
          accept="application/json,.json,text/plain"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            try {
              importar(await f.text(), "arquivo");
            } catch (err) {
              setAviso(mensagemErro(err));
            }
          }}
        />
      </div>

      <form
        className="mt-4"
        onSubmit={(e) => {
          e.preventDefault();
          importar(colado, "texto colado");
        }}
      >
        <label htmlFor={idCampo} className="text-sm text-ink-2">
          Ou cole aqui o link, o conteúdo do arquivo ou ids separados por vírgula
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id={idCampo}
            value={colado}
            onChange={(e) => setColado(e.target.value)}
            placeholder="camara:204379, senado:5672"
            autoComplete="off"
            className="h-10 min-w-0 flex-1 rounded-lg border border-line-strong bg-bg px-3 text-base text-ink placeholder:text-muted"
          />
          <Botao type="submit" disabled={!colado.trim()}>
            Importar
          </Botao>
        </div>
      </form>

      {aviso && (
        <p role="status" className="mt-3 rounded-md bg-sunken px-3 py-2 text-sm">
          {aviso}
        </p>
      )}
    </section>
  );
}

export function Seguindo() {
  const { ids, deixarDeSeguir } = useSeguindo();
  const [params, setParams] = useSearchParams();
  const doLink = idsDoParametro(params.get("seguir") ?? "");
  const consulta = useParlamentaresPorIds(ids);
  const resolvido = consulta.data && !consulta.isPlaceholderData;
  const semStorage = !storageDisponivel();

  const fecharImportacao = () =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.delete("seguir");
        return n;
      },
      { replace: true },
    );

  return (
    <>
      <Topo titulo="Seguindo" />
      {doLink.length > 0 && <ImportarDoLink ids={doLink} fechar={fecharImportacao} />}
      {params.has("seguir") && doLink.length === 0 && (
        <p role="alert" className="border-b border-line bg-warn-soft px-4 py-2 text-sm text-warn-ink">
          O link compartilhado não tem nenhum parlamentar válido.
        </p>
      )}
      {semStorage && (
        <p className="border-b border-line bg-warn-soft px-4 py-2 text-sm text-warn-ink">
          Este navegador não permite guardar dados (modo privado?). A lista vale só enquanto esta aba
          estiver aberta; exporte para não perder.
        </p>
      )}

      {ids.length === 0 ? (
        <EstadoVazio titulo="Você ainda não segue ninguém">
          <Link to="/buscar" className="text-accent underline underline-offset-2">
            Busque um parlamentar
          </Link>{" "}
          e toque em Seguir. A atividade de quem você segue aparece no Início.
        </EstadoVazio>
      ) : (
        <>
          <p className="px-4 pt-3 pb-1 text-xs text-muted">
            {plural(ids.length, "parlamentar", "parlamentares")}, na ordem em que você seguiu
          </p>
          {consulta.isError && !consulta.data ? (
            <EstadoErro erro={consulta.error} tentarDeNovo={() => void consulta.refetch()} />
          ) : (
            <ul className="border-b border-line">
              {ids.map((id) => {
                const p: ParlamentarResumo | undefined = consulta.data?.get(id);
                if (p) {
                  return (
                    <ParlamentarLinha
                      key={id}
                      p={p}
                      acao={
                        <button
                          type="button"
                          onClick={() => deixarDeSeguir(id)}
                          aria-label={`Deixar de seguir ${p.nome} (${CASA_CARGO[p.casa]})`}
                          className="h-8 rounded-full border border-line-strong px-3 text-sm font-semibold text-ink hover:border-ink-2"
                        >
                          Deixar de seguir
                        </button>
                      }
                    />
                  );
                }
                if (!resolvido) return <LinhaCarregando key={id} />;
                return (
                  <li key={id} className="border-b border-line px-4 py-3">
                    <p className="break-all font-mono text-sm">{id}</p>
                    <p className="text-sm text-muted">Não encontrado na base de dados.</p>
                    <div className="mt-2">
                      <Botao className="h-8 px-3 text-sm" onClick={() => deixarDeSeguir(id)}>
                        Remover da lista
                      </Botao>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      <ExportarImportar ids={ids} />
    </>
  );
}
