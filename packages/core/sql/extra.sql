-- O que o Drizzle não declara: extensões e índices especiais. Idempotente.
create extension if not exists pg_trgm;
create extension if not exists unaccent;
create index if not exists parlamentar_busca_trgm on parlamentar using gin (busca gin_trgm_ops);
