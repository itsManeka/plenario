// Ordem do feed da API: `ocorrido_em desc, id desc`, com ocorrido_em em microssegundos.
// O ISO dos arquivos exportados so tem ms; o instante em us vem do banco (mapa id -> us).
export function ordenarPorMicrossegundo<T extends { id: string; ocorridoEm: string }>(
  itens: readonly T[],
  usPorId: ReadonlyMap<string, bigint>,
): T[] {
  const us = (i: T): bigint => usPorId.get(i.id) ?? BigInt(Date.parse(i.ocorridoEm)) * 1000n;
  return [...itens].sort((a, b) => {
    const ua = us(a);
    const ub = us(b);
    if (ua !== ub) return ua < ub ? 1 : -1;
    const ia = BigInt(a.id);
    const ib = BigInt(b.id);
    return ia === ib ? 0 : ia < ib ? 1 : -1;
  });
}
