import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { lerConsulta, urlConsulta } from "./consulta_parser";

const fx = (n: string): string =>
  readFileSync(new URL(`./__fixtures__/${n}.html`, import.meta.url), "utf8");

describe("lerConsulta (esboco T4)", () => {
  test("160575: milhar e comentarios ignorados", () => {
    expect(lerConsulta(fx("p160575"), 160575)).toEqual({
      tipo: "ok",
      votosSim: 721508,
      votosNao: 1142443,
      apuradoEm: new Date("2026-10-28T13:18:46.000Z"),
    });
  });
  test("172395 e 176111", () => {
    const a = lerConsulta(fx("p172395"), 172395);
    expect(a.tipo === "ok" && [a.votosSim, a.votosNao]).toEqual([439, 371]);
    const b = lerConsulta(fx("p176111"), 176111);
    expect(b.tipo === "ok" && [b.votosSim, b.votosNao]).toEqual([0, 0]);
  });
  test("1181 encerrada; id errado e template_alterado", () => {
    expect(lerConsulta(fx("p1181"), 1181)).toEqual({ tipo: "sem_dado", motivo: "encerrada" });
    expect(lerConsulta(fx("p1181"), 5).tipo).toBe("template_alterado");
  });
  test("lixo nao lanca", () => {
    expect(lerConsulta("", 1).tipo).toBe("template_alterado");
    expect(lerConsulta("<<<!-- x", 1).tipo).toBe("template_alterado");
  });
  test("urlConsulta", () => {
    expect(urlConsulta(160575)).toBe(
      "https://www12.senado.leg.br/ecidadania/visualizacaomateria?id=160575",
    );
  });
});
