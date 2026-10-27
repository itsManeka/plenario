// Normalização usada na coluna `parlamentar.busca` e no `q` da busca — os dois lados
// precisam normalizar igual, senão "joao" não acha "João".
export function normalizarBusca(...partes: (string | null | undefined)[]): string {
  return partes
    .filter(Boolean)
    .join(" ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
