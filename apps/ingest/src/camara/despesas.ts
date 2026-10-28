import { createHash } from "node:crypto";
import { sql } from "@plenario/core/db";
import { baixar, bytesDoZip, etagRemoto, lerDados } from "./arquivos";
import { type EstadoCursor, type Periodo, anosEntre, emLotes, fmt, hojeBrasilia, idCamara, log } from "./comum";

const URL_CEAP = (ano: number) => `https://www.camara.leg.br/cotas/Ano-${ano}.json.zip`;

interface DespesaArquivo {
  idDeputado?: number | null; // ausente nas lideranças/órgãos, que não são parlamentar
  ano: number;
  mes: number;
  descricao: string | null;
  fornecedor: string | null;
  cnpjCPF: string | null;
  numero: string | null;
  tipoDocumento: string | null;
  dataEmissao: string | null;
  valorDocumento: string | null;
  valorGlosa: string | null;
  valorLiquido: string | null;
  parcela: number | null;
  lote: string | null;
  passageiro: string | null;
  trecho: string | null;
  idDocumento: number | null;
  urlDocumento: string | null;
}

const ultimoDiaDoMes = (ano: number, mes: number) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();
const pad2 = (n: number) => String(n).padStart(2, "0");

export interface ResultadoDespesas {
  ultimaData: string;
  etags: Record<string, string>;
}

/**
 * CEAP por ano. A granularidade é o mês: para cada mês do período, apaga as despesas
 * `camara:*` daquele mês e regrava o que o arquivo traz, numa transação. Assim documento
 * corrigido ou cancelado na fonte some daqui também, e o id derivado do conteúdo (ver `idDespesa`) não
 * deixa lixo.
 */
export async function ingerirDespesas(
  p: Periodo,
  parlamentares: Set<string>,
  cursor: EstadoCursor | null,
): Promise<ResultadoDespesas> {
  const etags: Record<string, string> = { ...(cursor?.etags ?? {}) };
  const hoje = hojeBrasilia();

  for (const ano of anosEntre(p.desde, p.ate)) {
    const inicio = Date.now();
    const mesIni = ano === Number(p.desde.slice(0, 4)) ? Number(p.desde.slice(5, 7)) : 1;
    const mesFim = ano === Number(p.ate.slice(0, 4)) ? Number(p.ate.slice(5, 7)) : 12;
    if (p.incremental && etags[`${ano}`] === `${await etagRemoto(URL_CEAP(ano))}|${mesIni}`) {
      log(`despesas ${ano}: arquivo não mudou desde a última carga, pulando`);
      continue;
    }
    const arq = await baixar(URL_CEAP(ano));
    if (!arq) {
      log(`despesas ${ano}: arquivo ainda não publicado, pulando`);
      continue;
    }

    const linhas: Record<string, unknown>[] = [];
    const ocorrencias = new Map<string, number>();
    // (parlamentar, mês) -> maior data de documento do mês, pro card do mês corrente
    const meses = new Map<string, { parlamentarId: string; mes: number; ultimaData: string | null }>();
    let ignoradas = 0;

    for await (const d of lerDados<DespesaArquivo>(bytesDoZip(arq.caminho))) {
      if (d.ano !== ano || d.mes < mesIni || d.mes > mesFim) continue;
      if (!d.idDeputado) continue; // liderança de partido/bloco: não é parlamentar
      const parlamentarId = idCamara(d.idDeputado);
      if (!parlamentares.has(parlamentarId)) {
        ignoradas++;
        continue;
      }
      let id = idDespesa(d);
      const n = (ocorrencias.get(id) ?? 0) + 1;
      ocorrencias.set(id, n);
      if (n > 1) id = `${id}-${n}`;

      const data = d.dataEmissao?.slice(0, 10) || null;
      linhas.push({
        id,
        parlamentar_id: parlamentarId,
        ano: d.ano,
        mes: d.mes,
        categoria: d.descricao?.trim() || "(sem categoria)",
        fornecedor: d.fornecedor?.trim() || null,
        documento_fornecedor: d.cnpjCPF?.replace(/\D/g, "") || null,
        valor: d.valorLiquido?.trim() || "0",
        data,
        url_documento: d.urlDocumento?.trim() || null,
      });
      const chaveMes = `${parlamentarId}|${d.mes}`;
      const m = meses.get(chaveMes) ?? { parlamentarId, mes: d.mes, ultimaData: null };
      if (data && data.slice(0, 7) === `${ano}-${pad2(d.mes)}` && (!m.ultimaData || data > m.ultimaData)) {
        m.ultimaData = data;
      }
      meses.set(chaveMes, m);
    }

    const eventos = [...meses.values()].map((m) => {
      const ref = `${ano}-${pad2(m.mes)}`;
      const fim = `${ref}-${pad2(ultimoDiaDoMes(ano, m.mes))}`;
      // Mês fechado: o card fica no último dia do mês. Mês corrente: no dia do documento mais
      // recente (não no fim do mês, que estaria no futuro e furaria o topo do feed).
      const dia = fim < hoje ? fim : (m.ultimaData ?? `${ref}-01`);
      return {
        parlamentar_id: m.parlamentarId,
        tipo: "despesa_mensal",
        ocorrido_em: `${dia}T23:59:59-03:00`,
        ref_id: ref,
      };
    });

    await sql.begin(async (tx) => {
      await tx`delete from despesa where id like 'camara:%' and ano = ${ano} and mes between ${mesIni} and ${mesFim}`;
      await emLotes(linhas, 2000, (lote) => tx`
        insert into despesa ${sql(lote as never)}
        on conflict (id) do update set
          parlamentar_id = excluded.parlamentar_id, ano = excluded.ano, mes = excluded.mes,
          categoria = excluded.categoria, fornecedor = excluded.fornecedor,
          documento_fornecedor = excluded.documento_fornecedor, valor = excluded.valor,
          data = excluded.data, url_documento = excluded.url_documento`);
      await emLotes(eventos, 2000, (lote) => tx`
        insert into evento ${sql(lote as never)}
        on conflict (parlamentar_id, tipo, ref_id) do update set ocorrido_em = excluded.ocorrido_em
        where evento.ocorrido_em is distinct from excluded.ocorrido_em`);
      // mês que deixou de ter despesa na fonte (documento cancelado) perde o card
      await tx`
        delete from evento e
        where e.tipo = 'despesa_mensal' and e.parlamentar_id like 'camara:%'
          and e.ref_id between ${`${ano}-${pad2(mesIni)}`} and ${`${ano}-${pad2(mesFim)}`}
          and not exists (
            select 1 from despesa d
            where d.parlamentar_id = e.parlamentar_id and d.ano = ${ano}
              and d.mes = substring(e.ref_id from 6)::int)`;
    });

    etags[`${ano}`] = `${arq.etag}|${mesIni}`;
    const total = linhas.reduce((s, l) => s + Number(l.valor), 0);
    log(
      `despesas ${ano} (meses ${mesIni}-${mesFim}): ${fmt(linhas.length)} documentos, ` +
        `R$ ${total.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}, ${fmt(eventos.length)} cards mensais` +
        `${ignoradas ? `, ${fmt(ignoradas)} de deputado fora da legislatura ignorados` : ""} ` +
        `em ${((Date.now() - inicio) / 1000).toFixed(0)}s`,
    );
  }
  return { ultimaData: p.ate, etags };
}

/**
 * `idDocumento` não identifica a linha: vem 0 ou nulo em milhares delas (telefonia, compensação
 * de passagem, estorno) e, nas passagens do SIGEPA, se repete dentro do ano (uma linha por
 * tarifa/taxa/reembolso do mesmo bilhete) e entre anos (é outra numeração). O id então é
 * `idDocumento` + hash do conteúdo da linha, e linhas idênticas recebem sufixo de ocorrência
 * no chamador. Como o hash inclui ano e mês, o id não depende do recorte processado.
 */
function idDespesa(d: DespesaArquivo): string {
  const chave = [
    d.idDocumento,
    d.idDeputado,
    d.ano,
    d.mes,
    d.descricao,
    d.fornecedor,
    d.cnpjCPF,
    d.numero,
    d.tipoDocumento,
    d.dataEmissao,
    d.valorDocumento,
    d.valorGlosa,
    d.valorLiquido,
    d.parcela,
    d.lote,
    d.passageiro,
    d.trecho,
    d.urlDocumento,
  ].join("|");
  return idCamara(`${d.idDocumento || 0}-${createHash("sha1").update(chave).digest("hex").slice(0, 12)}`);
}
