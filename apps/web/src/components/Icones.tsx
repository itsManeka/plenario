import type { SVGProps } from "react";

// Ícones inline (traço 1.75, 24×24), sem dependência. Decorativos por padrão:
// o texto ao lado carrega o significado.

type P = SVGProps<SVGSVGElement> & { tamanho?: number };

function Base({ tamanho = 20, children, ...rest }: P) {
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconeInicio = (p: P) => (
  <Base {...p}>
    <path d="M3 10.5 12 4l9 6.5" />
    <path d="M5 9.5V20h14V9.5" />
    <path d="M10 20v-5h4v5" />
  </Base>
);

export const IconeBusca = (p: P) => (
  <Base {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </Base>
);

export const IconeSeguindo = (p: P) => (
  <Base {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5" />
    <path d="M16 11.5l2 2 4-4" />
  </Base>
);

export const IconePredio = (p: P) => (
  <Base {...p}>
    <path d="M3 21h18" />
    <path d="M5 18v-7M9.67 18v-7M14.33 18v-7M19 18v-7" />
    <path d="M2.5 9 12 4l9.5 5z" />
  </Base>
);

export const IconeSim = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12.3 2.7 2.7L16.2 9.5" />
  </Base>
);

export const IconeNao = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m9 9 6 6M15 9l-6 6" />
  </Base>
);

export const IconeAbstencao = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12h8" />
  </Base>
);

export const IconeObstrucao = (p: P) => (
  <Base {...p}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
    <path d="M8 12h8" />
    <path d="M8 8.5h8M8 15.5h8" />
  </Base>
);

export const IconeAusente = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" strokeDasharray="3 3" />
  </Base>
);

export const IconePresidencia = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9 9h6M12 9v6" />
  </Base>
);

export const IconeOutro = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="8.5" cy="12" r=".6" fill="currentColor" />
    <circle cx="12" cy="12" r=".6" fill="currentColor" />
    <circle cx="15.5" cy="12" r=".6" fill="currentColor" />
  </Base>
);

export const IconeDocumento = (p: P) => (
  <Base {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M9 13h6M9 17h6" />
  </Base>
);

export const IconeMoeda = (p: P) => (
  <Base {...p}>
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <circle cx="12" cy="12" r="2.5" />
    <path d="M6.5 9.5v5M17.5 9.5v5" />
  </Base>
);

export const IconeExterno = (p: P) => (
  <Base {...p}>
    <path d="M14 4h6v6" />
    <path d="M20 4 11 13" />
    <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
  </Base>
);

export const IconeMais = (p: P) => (
  <Base {...p}>
    <path d="M12 5v14M5 12h14" />
  </Base>
);

export const IconeCheck = (p: P) => (
  <Base {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Base>
);

export const IconeVoltar = (p: P) => (
  <Base {...p}>
    <path d="M15 18 9 12l6-6" />
  </Base>
);

export const IconeAlerta = (p: P) => (
  <Base {...p}>
    <path d="M12 4 2.8 19.5h18.4z" />
    <path d="M12 10v4.5M12 17.2v.1" />
  </Base>
);

export const IconeBaixar = (p: P) => (
  <Base {...p}>
    <path d="M12 4v11M7 10.5 12 15.5l5-5" />
    <path d="M4.5 19.5h15" />
  </Base>
);

export const IconeSubir = (p: P) => (
  <Base {...p}>
    <path d="M12 15.5V4.5M7 9l5-5 5 5" />
    <path d="M4.5 19.5h15" />
  </Base>
);

export const IconeLink = (p: P) => (
  <Base {...p}>
    <path d="M10 14a4.5 4.5 0 0 0 6.4.2l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2" />
    <path d="M14 10a4.5 4.5 0 0 0-6.4-.2l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" />
  </Base>
);

export const IconeIgual = (p: P) => (
  <Base {...p}>
    <path d="M6 9.5h12M6 14.5h12" />
  </Base>
);

export const IconeDiferente = (p: P) => (
  <Base {...p}>
    <path d="M6 9.5h12M6 14.5h12M15 5.5l-6 13" />
  </Base>
);
