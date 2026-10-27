import { db, schema } from "@plenario/core/db";
import { eq, sql as dsql } from "drizzle-orm";

export interface EstadoCursor {
  ate?: string; // última data (AAAA-MM-DD) coberta por inteiro
  [k: string]: unknown;
}

export async function lerCursor(fonte: string): Promise<EstadoCursor | null> {
  const [linha] = await db
    .select({ estado: schema.ingestCursor.estado })
    .from(schema.ingestCursor)
    .where(eq(schema.ingestCursor.fonte, fonte));
  return (linha?.estado as EstadoCursor | null | undefined) ?? null;
}

// Nunca recua: uma carga avulsa de um período antigo (--desde/--ate no passado) não pode fazer
// a próxima execução incremental reprocessar tudo desde lá.
export async function gravarCursor(fonte: string, estado: EstadoCursor): Promise<void> {
  const atual = await lerCursor(fonte);
  const final: EstadoCursor = { ...atual, ...estado };
  if (atual?.ate && estado.ate && atual.ate > estado.ate) final.ate = atual.ate;
  await db
    .insert(schema.ingestCursor)
    .values({ fonte, ultimoSync: new Date(), estado: final })
    .onConflictDoUpdate({
      target: schema.ingestCursor.fonte,
      set: { ultimoSync: dsql`excluded.ultimo_sync`, estado: dsql`excluded.estado` },
    });
}
