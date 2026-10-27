import { Link } from "react-router";
import { Topo } from "../components/Layout";
import { EstadoVazio } from "../components/ui";

export function NaoEncontrado() {
  return (
    <>
      <Topo titulo="Página não encontrada" voltar />
      <EstadoVazio titulo="Este endereço não existe">
        <Link to="/" className="text-accent underline underline-offset-2">
          Voltar ao início
        </Link>
      </EstadoVazio>
    </>
  );
}
