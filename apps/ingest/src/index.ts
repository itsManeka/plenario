// Uso:
//   bun run start camara [--desde AAAA-MM-DD] [--ate AAAA-MM-DD]
//   bun run start senado [--desde AAAA-MM-DD] [--ate AAAA-MM-DD]
//   bun run start tudo   [--desde ...]
// Sem --desde, cada fonte retoma do `ingest_cursor` (ou do início da legislatura atual).

import { sql } from "@plenario/core/db";
import * as camara from "./camara";
import * as senado from "./senado";

export interface OpcoesIngest {
  desde?: string;
  ate?: string;
}

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const alvo = process.argv[2] ?? "tudo";
const opcoes: OpcoesIngest = { desde: arg("desde"), ate: arg("ate") };

try {
  if (alvo === "camara" || alvo === "tudo") await camara.run(opcoes);
  if (alvo === "senado" || alvo === "tudo") await senado.run(opcoes);
} finally {
  await sql.end();
}
