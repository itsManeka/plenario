// Períodos em que cada deputado esteve de fato em exercício na legislatura 57: é o denominador
// da presença. Vem de `/deputados/{id}/historico`, que é uma lista de mudanças de status.
//
// Regra (validada contra os votos gravados):
//   - abre período: `situacao = "Exercício"` ou texto com "Entrada -" (posse, reassunção). A
//     fonte às vezes funde dois atos num registro ("Entrada - Reassunção / DIVERSO - Convocação")
//     e a `situacao` fica CONVOCADO; sem olhar o texto, 1.071 votos caíam fora de período;
//   - fecha período: texto com "Saída -" ou situação Licença/SUPLENCIA/VACANCIA/SUSPENSO, com
//     `motivo_fim` = `descricaoStatus` da fonte. CONVOCADO sozinho e `situacao` nula
//     (nome/partido no início da legislatura) não mexem; "Alteração de partido" vem com
//     situação "Exercício" e não quebra o período.
//
// `fim` é o último dia em exercício: o dia anterior ao ato de saída. No dia do ato o deputado
// já está fora na prática (o suplente toma posse no mesmo dia). Exceção por evidência: o ato
// é registrado com atraso de alguns dias às vezes (licença lançada às 23h55 de um dia em que o
// deputado votou à noite e votou de novo na manhã seguinte). Se o deputado votou até
// `TOLERANCIA_DIAS` depois do `fim` e antes do próximo período, o `fim` vai até o dia desse
// voto: quem votou estava em exercício. Voto mais distante que isso fica fora e é inconsistência
// da fonte (ex.: ministro que vota sem reassunção registrada).
//
// Política de atualização (o histórico é uma chamada por deputado):
//   - deputado sem nenhum período gravado, ou cujo `em_exercicio` mudou nesta carga: rebusca;
//   - a cada 7 dias rebusca todos (pega licença curta que começou e terminou entre duas cargas).

import { sql } from "@plenario/core/db";
import { buscarJson } from "../http";
import { API, LEGISLATURA, fmt, gravarCursor, idCamara, lerCursor, log, somarDias } from "./comum";

interface RegistroHistorico {
  idLegislatura: number;
  dataHora: string | null;
  situacao: string | null;
  condicaoEleitoral: string | null;
  descricaoStatus: string | null;
}

export interface Periodo {
  inicio: string;
  fim: string | null;
  motivoFim: string | null;
}

// situações que, sozinhas, tiram o deputado do exercício; CONVOCADO sem "Entrada" é só o
// chamado do suplente e não muda nada
const SITUACOES_FORA = new Set(["Licença", "SUPLENCIA", "VACANCIA", "SUSPENSO", "Afastado", "Fim de Mandato"]);

export function periodosDeExercicio(historico: RegistroHistorico[]): Periodo[] {
  const registros = historico
    .filter((r) => r.idLegislatura === LEGISLATURA && r.dataHora && r.situacao)
    .sort((a, b) => a.dataHora!.localeCompare(b.dataHora!));
  const periodos: Periodo[] = [];
  let aberto: Periodo | null = null;
  for (const r of registros) {
    const dia = r.dataHora!.slice(0, 10);
    const desc = r.descricaoStatus ?? "";
    // a fonte às vezes funde dois atos do mesmo minuto num registro só ("Entrada - Reassunção /
    // DIVERSO - Convocação...") e a `situacao` fica a da convocação: o texto "Entrada" manda
    const entra = r.situacao === "Exercício" || /(^|\/ *)Entrada -/.test(desc);
    const sai = /(^|\/ *)Saída -/.test(desc) || SITUACOES_FORA.has(r.situacao!);
    if (entra && !sai) {
      if (!aberto) {
        aberto = { inicio: dia, fim: null, motivoFim: null };
        periodos.push(aberto);
      }
    } else if (sai && aberto) {
      // saída no mesmo dia da entrada: o período tem um dia só (ex.: posse e licença na sequência)
      aberto.fim = dia > aberto.inicio ? somarDias(dia, -1) : dia;
      aberto.motivoFim = r.descricaoStatus?.trim() || r.situacao;
      aberto = null;
    }
  }
  // dois períodos podem cair no mesmo `inicio` (sai e volta no mesmo dia): funde, já que a PK é
  // (parlamentar, inicio)
  const fundidos: Periodo[] = [];
  for (const p of periodos) {
    const ant = fundidos[fundidos.length - 1];
    if (ant && ant.inicio === p.inicio) {
      ant.fim = p.fim;
      ant.motivoFim = p.motivoFim;
    } else if (ant && ant.fim && p.inicio <= somarDias(ant.fim, 1)) {
      // saiu e voltou no mesmo dia (ou no seguinte): é um período só
      ant.fim = p.fim;
      ant.motivoFim = p.motivoFim;
    } else fundidos.push(p);
  }
  return fundidos;
}

const REBUSCA_TODOS_DIAS = 7;
const TOLERANCIA_DIAS = 7;

/** Estende `fim` até o último voto em até TOLERANCIA_DIAS, sem invadir o próximo período. */
export function estenderPorVoto(ps: Periodo[], dias: string[]): number {
  let n = 0;
  ps.forEach((p, i) => {
    if (!p.fim) return;
    const limite = somarDias(p.fim, TOLERANCIA_DIAS);
    const proximo = ps[i + 1]?.inicio;
    const ultimo = dias.filter((d) => d > p.fim! && d <= limite && (!proximo || d < proximo)).pop();
    if (ultimo) {
      p.fim = ultimo;
      n++;
    }
  });
  return n;
}

export async function ingerirExercicio(idsLegislatura: number[], mudaram: Set<number>): Promise<void> {
  const inicio = Date.now();
  const fonte = "camara:exercicio";
  const cursor = await lerCursor(fonte);
  const ultimoCompleto = cursor?.ultimoCompleto as string | undefined;
  const completo = !ultimoCompleto || Date.now() - Date.parse(ultimoCompleto) > REBUSCA_TODOS_DIAS * 86_400_000;

  const comPeriodo = new Set(
    (await sql<{ parlamentar_id: string }[]>`
      select distinct parlamentar_id from exercicio where parlamentar_id like 'camara:%'`).map((l) => l.parlamentar_id),
  );
  const alvo = completo
    ? idsLegislatura
    : idsLegislatura.filter((id) => mudaram.has(id) || !comPeriodo.has(idCamara(id)));

  let periodos = 0;
  let semPeriodo = 0;
  const linhas: { parlamentar_id: string; inicio: string; fim: string | null; motivo_fim: string | null }[] = [];
  const ids = alvo.map((id) => idCamara(id));
  const diasComVoto = new Map<string, string[]>();
  for (const l of await sql<{ p: string; dia: string }[]>`
    select distinct vo.parlamentar_id as p,
      to_char(v.data_hora at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') as dia
    from voto vo join votacao v on v.id = vo.votacao_id
    where vo.parlamentar_id = any(${ids}) order by 2`) {
    const lista = diasComVoto.get(l.p) ?? [];
    lista.push(l.dia);
    diasComVoto.set(l.p, lista);
  }

  let estendidos = 0;
  await Promise.all(
    alvo.map(async (id) => {
      const r = await buscarJson<{ dados: RegistroHistorico[] }>(`${API}/deputados/${id}/historico`);
      const ps = periodosDeExercicio(r.dados);
      estendidos += estenderPorVoto(ps, diasComVoto.get(idCamara(id)) ?? []);
      if (ps.length === 0) semPeriodo++;
      periodos += ps.length;
      for (const p of ps) {
        linhas.push({ parlamentar_id: idCamara(id), inicio: p.inicio, fim: p.fim, motivo_fim: p.motivoFim });
      }
    }),
  );

  if (alvo.length > 0) {
    // troca o conjunto inteiro de cada deputado rebuscado: período corrigido na fonte não deixa resto
    await sql.begin(async (tx) => {
      await tx`delete from exercicio where parlamentar_id = any(${ids})`;
      for (let i = 0; i < linhas.length; i += 2000) {
        await tx`insert into exercicio ${sql(linhas.slice(i, i + 2000))}`;
      }
    });
  }

  await gravarCursor(fonte, { ultimoCompleto: completo ? new Date().toISOString() : ultimoCompleto });
  log(
    `exercício: ${fmt(alvo.length)} históricos ${completo ? "(rebusca completa)" : "(só novos/alterados)"}, ` +
      `${fmt(periodos)} períodos (${fmt(estendidos)} com fim estendido por voto)${semPeriodo ? `, ${fmt(semPeriodo)} sem nenhum período em exercício` : ""} ` +
      `em ${((Date.now() - inicio) / 1000).toFixed(0)}s`,
  );
}
