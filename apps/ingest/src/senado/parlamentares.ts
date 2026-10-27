import { db, schema } from "@plenario/core/db";
import { normalizarBusca } from "@plenario/core/texto";
import { and, eq, like, notInArray, sql as dsql } from "drizzle-orm";
import { buscarJson } from "../http";
import { BASE, INICIO_LEGISLATURA, LEGISLATURA, comoLista, log } from "./util";

type Lista<T> = T | T[] | null | undefined;

interface Identificacao {
  CodigoParlamentar: string;
  NomeParlamentar: string;
  NomeCompletoParlamentar?: string;
  UrlFotoParlamentar?: string;
  EmailParlamentar?: string;
  SiglaPartidoParlamentar?: string;
  UfParlamentar?: string;
}

interface Exercicio {
  DataInicio?: string;
  DataFim?: string;
  DescricaoCausaAfastamento?: string;
}

interface Mandato {
  UfParlamentar?: string;
  PrimeiraLegislaturaDoMandato?: { NumeroLegislatura?: string };
  SegundaLegislaturaDoMandato?: { NumeroLegislatura?: string };
  Exercicios?: { Exercicio?: Lista<Exercicio> } | null;
}

interface ParlamentarFonte {
  IdentificacaoParlamentar: Identificacao;
  Mandato?: Mandato; // lista/atual
  Mandatos?: { Mandato?: Lista<Mandato> }; // lista/legislatura
}

interface RespAtual {
  ListaParlamentarEmExercicio: { Parlamentares?: { Parlamentar?: Lista<ParlamentarFonte> } };
}

interface RespLegislatura {
  ListaParlamentarLegislatura: { Parlamentares?: { Parlamentar?: Lista<ParlamentarFonte> } };
}

export interface SenadorInfo {
  codigo: string;
  nome: string;
}

function https(url: string | undefined): string | null {
  return url ? url.replace(/^http:\/\//, "https://") : null;
}

function mandatosDe(p: ParlamentarFonte): Mandato[] {
  return [...comoLista(p.Mandato), ...comoLista(p.Mandatos?.Mandato)];
}

// "Exerceu na legislatura" = algum período de exercício que termina depois do início da 57ª.
// O filtro `exercicio=S` da fonte considera o mandato inteiro (8 anos): sem isto entram suplentes
// que só exerceram em 2019–2022.
function exerceuNaLegislatura(p: ParlamentarFonte): boolean {
  return mandatosDe(p).some((m) =>
    comoLista(m.Exercicios?.Exercicio).some((e) => (e.DataFim ?? "9999-12-31") >= INICIO_LEGISLATURA),
  );
}

interface LinhaExercicio {
  parlamentarId: string;
  inicio: string;
  fim: string | null;
  motivoFim: string | null;
}

// Períodos de exercício que tocam a 57ª, com as datas e a causa do afastamento como a fonte
// publica (não recortamos o início em 2023-02-01: quem vem do mandato anterior começou em 2019 e
// é isso que a fonte diz; quem calcula presença já limita ao início da legislatura). A lista da
// legislatura traz todos os mandatos; a "atual" só o corrente, então ela é só reserva.
function exerciciosDe(p: ParlamentarFonte, reserva: ParlamentarFonte | undefined): LinhaExercicio[] {
  const parlamentarId = `senado:${p.IdentificacaoParlamentar.CodigoParlamentar}`;
  const todos = mandatosDe(p).flatMap((m) => comoLista(m.Exercicios?.Exercicio));
  const fonte = todos.length > 0 ? todos : mandatosDe(reserva ?? p).flatMap((m) => comoLista(m.Exercicios?.Exercicio));
  const porInicio = new Map<string, LinhaExercicio>();
  for (const e of fonte) {
    const inicio = e.DataInicio?.slice(0, 10);
    if (!inicio) continue;
    const fim = e.DataFim?.slice(0, 10) || null;
    if (fim !== null && fim < INICIO_LEGISLATURA) continue;
    porInicio.set(inicio, {
      parlamentarId,
      inicio,
      fim,
      motivoFim: e.DescricaoCausaAfastamento?.trim() || null,
    });
  }
  return [...porInicio.values()];
}

function ufDoMandato(p: ParlamentarFonte): string | null {
  const id = p.IdentificacaoParlamentar;
  if (id.UfParlamentar) return id.UfParlamentar;
  const doMandato = mandatosDe(p).find(
    (m) =>
      m.PrimeiraLegislaturaDoMandato?.NumeroLegislatura === String(LEGISLATURA) ||
      m.SegundaLegislaturaDoMandato?.NumeroLegislatura === String(LEGISLATURA),
  );
  return doMandato?.UfParlamentar ?? mandatosDe(p)[0]?.UfParlamentar ?? null;
}

// Atualiza a tabela `parlamentar` com quem exerceu na 57ª e devolve o mapa código -> nome,
// usado depois pra casar autoria e criar voto.
export async function sincronizarParlamentares(): Promise<Map<string, SenadorInfo>> {
  const [atual, leg] = await Promise.all([
    buscarJson<RespAtual>(`${BASE}/senador/lista/atual.json`),
    buscarJson<RespLegislatura>(`${BASE}/senador/lista/legislatura/${LEGISLATURA}.json?exercicio=S`),
  ]);

  const emExercicio = comoLista(atual.ListaParlamentarEmExercicio.Parlamentares?.Parlamentar);
  const daLegislatura = comoLista(leg.ListaParlamentarLegislatura.Parlamentares?.Parlamentar);
  if (emExercicio.length < 70) {
    // 81 cadeiras; menos que isso é resposta truncada da fonte, e gravar marcaria gente como fora
    throw new Error(`lista de senadores em exercício veio com ${emExercicio.length} nomes; abortando`);
  }

  const codigosAtuais = new Set(emExercicio.map((p) => p.IdentificacaoParlamentar.CodigoParlamentar));
  const atualPorCodigo = new Map(emExercicio.map((p) => [p.IdentificacaoParlamentar.CodigoParlamentar, p]));
  // a lista "atual" tem dados mais frescos (partido, e-mail) — ela vence a da legislatura
  const porCodigo = new Map<string, ParlamentarFonte>();
  const exercicios: LinhaExercicio[] = [];
  const comExercicio = new Set<string>();
  for (const p of daLegislatura) {
    const cod = p.IdentificacaoParlamentar.CodigoParlamentar;
    if (!exerceuNaLegislatura(p)) continue;
    porCodigo.set(cod, p);
    exercicios.push(...exerciciosDe(p, atualPorCodigo.get(cod)));
    comExercicio.add(cod);
  }
  for (const p of emExercicio) {
    const cod = p.IdentificacaoParlamentar.CodigoParlamentar;
    porCodigo.set(cod, p);
    if (!comExercicio.has(cod)) exercicios.push(...exerciciosDe(p, undefined));
  }

  const linhas = [...porCodigo.values()].map((p) => {
    const id = p.IdentificacaoParlamentar;
    const nomeCivil = id.NomeCompletoParlamentar?.trim() || null;
    return {
      id: `senado:${id.CodigoParlamentar}`,
      casa: "senado" as const,
      idExterno: id.CodigoParlamentar,
      nome: id.NomeParlamentar.trim(),
      nomeCivil,
      partido: id.SiglaPartidoParlamentar?.trim() || null,
      uf: ufDoMandato(p),
      fotoUrl: https(id.UrlFotoParlamentar),
      email: id.EmailParlamentar?.trim() || null,
      emExercicio: codigosAtuais.has(id.CodigoParlamentar),
      busca: normalizarBusca(id.NomeParlamentar, nomeCivil),
      atualizadoEm: new Date(),
    };
  });

  await db.transaction(async (tx) => {
    await tx
      .insert(schema.parlamentar)
      .values(linhas)
      .onConflictDoUpdate({
        target: schema.parlamentar.id,
        set: {
          nome: dsql`excluded.nome`,
          nomeCivil: dsql`excluded.nome_civil`,
          // partido nulo na fonte não apaga o que já se sabia (ver completarPartidos)
          partido: dsql`coalesce(excluded.partido, ${schema.parlamentar.partido})`,
          uf: dsql`coalesce(excluded.uf, ${schema.parlamentar.uf})`,
          fotoUrl: dsql`excluded.foto_url`,
          email: dsql`excluded.email`,
          emExercicio: dsql`excluded.em_exercicio`,
          busca: dsql`excluded.busca`,
          atualizadoEm: dsql`excluded.atualizado_em`,
        },
      });
    // quem saiu de exercício desde a última carga e não veio em nenhuma das duas listas
    const ids = linhas.filter((l) => l.emExercicio).map((l) => l.id);
    await tx
      .update(schema.parlamentar)
      .set({ emExercicio: false, atualizadoEm: new Date() })
      .where(
        and(
          eq(schema.parlamentar.casa, "senado"),
          eq(schema.parlamentar.emExercicio, true),
          notInArray(schema.parlamentar.id, ids),
        ),
      );
    // períodos são substituídos por inteiro a cada carga: a fonte fecha período aberto, corrige
    // data de início e funde períodos, e um upsert por (parlamentar, início) deixaria sobra
    await tx.delete(schema.exercicio).where(like(schema.exercicio.parlamentarId, "senado:%"));
    if (exercicios.length > 0) await tx.insert(schema.exercicio).values(exercicios);
  });

  log(
    `parlamentares: ${linhas.length} na 57ª (${linhas.filter((l) => l.emExercicio).length} em exercício), ` +
      `${exercicios.length} períodos de exercício`,
  );
  return new Map(linhas.map((l) => [l.idExterno, { codigo: l.idExterno, nome: l.nome }]));
}

// Alguns ex-senadores vêm sem `SiglaPartidoParlamentar` na lista da legislatura; o partido
// registrado no voto mais recente dele é dado da mesma fonte, então completa com ele.
export async function completarPartidos(): Promise<void> {
  await db.execute(dsql`
    update parlamentar p set partido = x.partido, atualizado_em = now()
    from (
      select distinct on (v.parlamentar_id) v.parlamentar_id, v.partido_na_hora as partido
      from voto v join votacao vt on vt.id = v.votacao_id
      where vt.casa = 'senado' and v.partido_na_hora is not null and v.partido_na_hora <> 'S/Partido'
      order by v.parlamentar_id, vt.data_hora desc
    ) x
    where p.id = x.parlamentar_id and p.casa = 'senado' and p.partido is null`);
}
