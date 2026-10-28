// Helper de banco de teste do ingest. Os testes que o usam apagam tabelas: por isso a URL precisa
// terminar em "_test" ANTES de qualquer conexao ou truncate. Mesma regra de apps/api/src/app.test.ts.
//
// `@plenario/core/db` le DATABASE_URL na importacao: o import dele fica dentro de prepararBancoDeTeste(),
// depois da guarda. Teste que o use deve importar este modulo e so depois `await import("../senado/...")`.

const URL_PADRAO = "postgres://localhost:5432/plenario_test";
const SUFIXO_TESTE = /_test(\?.*)?$/;

// Tabelas que o helper apaga. Truncate com cascade tambem limpa o que referencia estas.
export const TABELAS_DO_INGEST = [
  "consulta_publica",
  "evento",
  "proposicao_autor",
  "proposicao",
  "parlamentar",
  "ingest_cursor",
] as const;

export type Sql = typeof import("@plenario/core/db").sql;

export type ContagemTabelas = Record<(typeof TABELAS_DO_INGEST)[number], number>;

// Nome do banco para a mensagem de erro, sem usuario/senha da URL.
function nomeDoBanco(url: string): string {
  const semQuery = url.split("?")[0] ?? url;
  return semQuery.slice(semQuery.lastIndexOf("/") + 1) || "(vazio)";
}

function exigirSufixoTeste(url: string, origem: string): string {
  if (!SUFIXO_TESTE.test(url)) {
    throw new Error(`${origem} precisa apontar para banco terminado em _test (banco atual: ${nomeDoBanco(url)})`);
  }
  return url;
}

// Pura: decide a URL do banco de teste a partir do ambiente, sem conectar. So a URL de teste e validada.
// DATABASE_URL herdado (o .env da raiz do repo traz o banco `plenario`) e sobrescrito e nunca usado,
// como em apps/api/src/app.test.ts.
export function resolverUrlDeTeste(env: Record<string, string | undefined>): string {
  return exigirSufixoTeste(env.TEST_DATABASE_URL ?? URL_PADRAO, "TEST_DATABASE_URL");
}

// Aplica a guarda, sobrescreve DATABASE_URL e so entao importa @plenario/core/db. Lanca antes de conectar.
export async function prepararBancoDeTeste(): Promise<Sql> {
  process.env.DATABASE_URL = resolverUrlDeTeste(process.env);
  const { sql } = await import("@plenario/core/db");
  return sql;
}

export async function limparTabelas(sql: Sql): Promise<void> {
  await sql`truncate consulta_publica, evento, proposicao_autor, proposicao, parlamentar, ingest_cursor restart identity cascade`;
}

export async function contarTabelas(sql: Sql): Promise<ContagemTabelas> {
  const [r] = await sql<ContagemTabelas[]>`select
    (select count(*)::int from consulta_publica) as consulta_publica,
    (select count(*)::int from evento) as evento,
    (select count(*)::int from proposicao_autor) as proposicao_autor,
    (select count(*)::int from proposicao) as proposicao,
    (select count(*)::int from parlamentar) as parlamentar,
    (select count(*)::int from ingest_cursor) as ingest_cursor`;
  if (!r) throw new Error("contagem de tabelas nao retornou linha");
  return r;
}

// Seed minimo: 1 parlamentar do Senado, 1 proposicao `senado:<codigo>` e o parlamentar como autor com ordem 1.
export async function semearMinimo(
  sql: Sql,
  codigo = "900001",
): Promise<{ parlamentarId: string; proposicaoId: string }> {
  const parlamentarId = "senado:9001";
  const proposicaoId = `senado:${codigo}`;
  await sql`insert into parlamentar (id, casa, id_externo, nome, busca)
    values (${parlamentarId}, 'senado', '9001', 'Parlamentar Teste', 'parlamentar teste')`;
  await sql`insert into proposicao (id, casa, id_externo, sigla_tipo, numero, ano)
    values (${proposicaoId}, 'senado', ${codigo}, 'PL', 1, 2026)`;
  await sql`insert into proposicao_autor (proposicao_id, parlamentar_id, ordem)
    values (${proposicaoId}, ${parlamentarId}, 1)`;
  return { parlamentarId, proposicaoId };
}
