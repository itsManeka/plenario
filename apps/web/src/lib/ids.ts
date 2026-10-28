import { arquivoId } from "@plenario/core/estatico";

// Na URL o id vai sem ":" ("/p/camara-204536"): fica legível, não é escapado como %3A e é o
// mesmo nome dos arquivos do site estático. A casa não tem hífen, então o primeiro "-" volta
// a ser ":". Links antigos com ":" continuam valendo.
export function idParaUrl(id: string): string {
  return arquivoId(id);
}

export function idDaUrl(segmento: string | undefined): string {
  const s = segmento ?? "";
  return s.includes(":") ? s : s.replace("-", ":");
}
