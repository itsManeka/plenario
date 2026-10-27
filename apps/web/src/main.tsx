import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { ApiError } from "./api/client";
import { Layout } from "./components/Layout";
import { Buscar } from "./pages/Buscar";
import { Inicio } from "./pages/Inicio";
import { NaoEncontrado } from "./pages/NaoEncontrado";
import { Perfil } from "./pages/Perfil";
import { Proposicao } from "./pages/Proposicao";
import { Seguindo } from "./pages/Seguindo";
import { Votacao } from "./pages/Votacao";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
      // 4xx não melhora tentando de novo
      retry: (n, erro) => !(erro instanceof ApiError && erro.status >= 400 && erro.status < 500) && n < 2,
    },
  },
});

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <Inicio /> },
      { path: "buscar", element: <Buscar /> },
      { path: "seguindo", element: <Seguindo /> },
      { path: "p/:id", element: <Perfil /> },
      { path: "votacoes/:id", element: <Votacao /> },
      { path: "proposicoes/:id", element: <Proposicao /> },
      { path: "*", element: <NaoEncontrado /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
