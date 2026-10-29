import { expect, test } from "bun:test";
import { ordenarPorMicrossegundo } from "./ordem";

const MS = "2026-01-01T00:00:00.000Z";

test("mesmo ms, us diferentes: ordena por us desc mesmo com id invertido", () => {
  const itens = [
    { id: "5", ocorridoEm: MS },
    { id: "3", ocorridoEm: MS },
  ];
  const us = new Map<string, bigint>([
    ["5", 1_000n],
    ["3", 1_001n],
  ]);
  expect(ordenarPorMicrossegundo(itens, us).map((i) => i.id)).toEqual(["3", "5"]);
});

test("mesmo us: desempata por id desc numerico", () => {
  const itens = [
    { id: "9", ocorridoEm: MS },
    { id: "10", ocorridoEm: MS },
  ];
  const us = new Map<string, bigint>([
    ["9", 7n],
    ["10", 7n],
  ]);
  expect(ordenarPorMicrossegundo(itens, us).map((i) => i.id)).toEqual(["10", "9"]);
});

test("id fora do mapa usa ms*1000 e nao some", () => {
  const ms = Date.parse(MS);
  const itens = [
    { id: "1", ocorridoEm: MS },
    { id: "2", ocorridoEm: MS },
  ];
  const us = new Map<string, bigint>([["2", BigInt(ms) * 1000n - 1n]]);
  const r = ordenarPorMicrossegundo(itens, us);
  expect(r.map((i) => i.id)).toEqual(["1", "2"]);
  expect(itens.map((i) => i.id)).toEqual(["1", "2"]);
});
