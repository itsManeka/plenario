# Consultas públicas do e-Cidadania

Spike (sem código) para trazer ao feed o placar das consultas públicas do e-Cidadania (Senado):
votos sim e não, instante da apuração, aviso fixo e link para a página oficial. Só número e data:
nenhum rótulo ("rejeitada", "favorita", "maioria"), nenhuma cor por lado.

Status: **aguarda o coletivo** (decisão 1). Nada entra no upstream (PR) antes da resposta na issue;
o código é feito antes, num branch do fork.

## Fonte

Levantamento de 2026-10-27 (OpenAPI do dadosabertos, termos de uso do e-Cidadania, Resolução
26/2013); a medição do HTML abaixo é de 2026-10-28.

- Página: `https://www12.senado.leg.br/ecidadania/visualizacaomateria?id=<codigoMateria>`.
- **Não há API oficial.** A OpenAPI de `legis.senado.leg.br/dadosabertos` (158 paths) não tem
  e-Cidadania, consulta, ideia ou enquete; `/ecidadania/rest/consultapublica/{id}` devolve 404.
  A página é HTML renderizado no servidor, com o placar no markup.
- Todo projeto em tramitação no Senado tem consulta aberta, sem prazo (Resolução 26/2013). É
  enquete aberta: uma pessoa cadastrada vota uma vez, mas não é amostra da população.
- Termos de uso do e-Cidadania: não citam licença nem proíbem leitura automatizada; só sancionam
  contas e robôs que **participam** (item 40). `robots.txt` libera tudo para `User-agent: *`.
- Câmara (e-Democracia): nada na API v2. Fora de escopo.

## Medição (2026-10-28, 10:17–10:25 BRT)

11 requisições, intervalo ≥ 2 s, User-Agent do ingest (`apps/ingest/src/http.ts`):
`plenario/0.1 (+https://github.com/tonhonho/plenario; dados abertos, sem fins lucrativos)`.

| Caso | id | HTTP | Resultado |
|---|---|---|---|
| Muitos votos (PL 5064/2023) | 160575 | 200, 156.662 B | 721.508 sim × 1.142.443 não, "Votos apurados até 28/10/2026 10:18:46" |
| Poucos votos (PL 2/2026) | 172395 | 200 | 439 × 371, sem separador de milhar |
| Matéria nova (PL 5675/2026) | 176111 | 200 | 0 × 0 **com** "Votos apurados até ..." (zero legítimo) |
| Transformada em lei (PLS 43/1995) | 1181 | 200, 154.812 B | 0 × 0, `TRAMITAÇÃO ENCERRADA`, **sem** "Votos apurados" (sem dado) |
| Inexistente | 999999999 | 302 → `principalmateria` | corpo vazio |

- `text/html;charset=utf-8`, sem redirect no caso normal, sem captcha nem bloqueio, sem JS para os
  números (o JS só incrementa o contador local depois do voto do visitante).
- Cache de borda: `cache-control: max-age=30`, sem ETag nem Last-Modified. "Votos apurados até" é o
  instante de geração da página (horário de Brasília), não o do último voto.
- **`id` = `codigoMateria`**: confirmado em 160575, 172395, 176111 e 1181 contra
  `dadosabertos/processo` (identificação e autoria batem; `input#materiaId` repete o id). Liga a
  consulta à proposição já ingerida (`senado:<cod>`) sem cruzar por texto.
- Universo: `dadosabertos/processo?tramitando=S` devolve 10.917 processos; pelo critério do ingest
  (PL, PLP, PEC, PDL, PRS, objetivo "Iniciadora") são 5.023, dos quais 4.133 PL. ~155 KB por página.
- Não medido: matéria arquivada que preserve votos antigos.

### Excertos do markup (id 160575)

```html
<section class="materia-identificacao">
    <input type="hidden" id="materiaId" value="160575" />
    <header>PROJETO DE LEI nº 5064 de 2023</header>
    <section>(<span>PL 5064/2023</span>)</section>
</section>
```

```html
<figure class="grafico-consulta-publica">
    <header><span>Sim</span><span>Não</span></header>
    <section><div style="width:38.7085282821%"></div></section>
    <footer>
        <span class="contabilizacao-favor">721.508</span>
        <span class="contabilizacao-contra">1.142.443</span>
    </footer>
</figure>
<div>
    <div id="msg-contabilizacao-voto">Votos apurados até 28/10/2026 10:18:46</div>
</div>
```

Matéria encerrada (id 1181): `<div class="tramitacao-encerrada text-right">TRAMITAÇÃO ENCERRADA</div>`,
contador 0/0 e nenhum `#msg-contabilizacao-voto`.

**Armadilha:** o template tem trechos comentados com as mesmas classes
(`<!-- <span class="contabilizacao-favor" ...>10+</span> -->`, duas vezes). Um regex ingênuo lê "10+".

### Regras para o parser (f03)

1. Remover comentários HTML antes de qualquer busca.
2. Placar: `span.contabilizacao-favor` (sim) e `span.contabilizacao-contra` (não) dentro de
   `figure.grafico-consulta-publica footer`; valor `^\d{1,3}(\.\d{3})*$`, remover os pontos. Não casou
   = erro, nunca 0.
3. Apuração: `#msg-contabilizacao-voto` com âncora `Votos apurados até` e
   `dd/mm/aaaa hh:mm:ss` em America/Sao_Paulo. Ausente = sem dado (pula e loga).
4. `.tramitacao-encerrada` presente = pula.
5. Identidade: `input#materiaId` igual ao id pedido; senão erro (template mudou).
6. Não seguir redirect: 302 = matéria inexistente. Não usar a largura da barra (vale 50% com 0 votos).

Implementação (`apps/ingest/src/senado/consulta_parser.ts`, `apps/ingest/src/http.ts`):

- O HTML não é confiável: nenhuma regex roda sobre a página inteira. Tags, aspas e comentários saem de
  uma varredura linear única (como no HTML5: `<` só abre tag antes de letra, `/` ou `!`; aspa só delimita
  valor logo após `=`; `<!--` sem `-->` vai até o fim). Página malformada termina rápido e vira
  `template_alterado`, nunca placar.
- `lerConsulta` nunca lança: devolve `ok`, `sem_dado` (`encerrada` | `sem_apuracao`) ou
  `template_alterado` com `motivo`. `urlConsulta` lança `RangeError` para código que não é inteiro positivo.
- `buscarTexto` lê no máximo 5 MiB (acima disso lança, sem nova tentativa), cancela o corpo que não vai ler
  e devolve `redirecionada` para qualquer 3xx; quem chama decide quais status valem "matéria inexistente".

Fixtures sugeridas: as páginas 160575 (milhar + comentários "10+"), 172395 (sem milhar), 176111
(0/0 legítimo), 1181 (encerrada) e o cabeçalho do 302.

Extra, não usado: `GET /ecidadania/restcolecaomaismateria` devolve JSON (2 KB) com as poucas matérias
mais votadas e os números como texto com milhar. Serve de conferência, não de fonte.

## Decisões

Colhidas em 2026-10-28. A 1 depende do coletivo; as demais são o default proposto e valem até o
coletivo dizer o contrário na issue.

1. **Scraping do e-Cidadania como fonte oficial?** Aguarda coletivo. Default: aceitar. É página
   oficial do Senado, sem contrato de API; a leitura é lenta, identificada e cita a fonte em cada
   card. **Se o coletivo recusar, o epic para aqui.**
2. **Onde o evento fica gravado:** no primeiro signatário (`proposicao_autor.ordem = 1`, ou autor
   único sem ordem, regra já usada em `papelAutoria`, `apps/api/src/util.ts`). Um PL com 30 autores
   não vira 30 cards iguais. Toda proposição do Senado ingerida tem ao menos um senador em
   `proposicao_autor` (o ingest busca por autor), mas pode faltar o primeiro signatário (vários
   autores sem `ordem`): nesse caso a leitura vai para `consulta_publica` e nenhum evento é gerado. O card é do tipo "prédio" (cabeçalho "Consulta pública · Senado · data", autor
   citado no corpo), porque quem votou foi o público. Item sem parlamentar exigiria
   `evento.parlamentar_id` nulo ou rota nova: fica para o coletivo, se quiser.
3. **Quando gerar evento:** no máximo um por mês por proposição. `ref_id = <proposicao_id>:<AAAA-MM>`
   do mês da apuração, com sim, não e `apuradoEm` congelados em `resumo`. Cada card é um fato
   datado que não muda depois. A tabela `consulta_publica` guarda sempre a última leitura.
4. **Aviso fixo (texto exato):**
   > Enquete aberta no e-Cidadania: cada pessoa cadastrada vota uma vez. Não representa a população.
5. **Elegibilidade:** proposições do Senado já ingeridas (`proposicao`, `casa = 'senado'`). A tabela
   não tem flag de tramitação; matéria com `.tramitacao-encerrada` na página é pulada. Sem mudança
   de schema para isso.
6. **Frequência:** até 500 matérias por execução do ingest diário, 1 requisição por segundo
   (~8 min, ~78 MB), a de apuração mais antiga primeiro; a que nunca foi lida vem antes de todas
   (rodízio, para cobrir a base ao longo dos dias). Uma volta leva no máximo ~10 dias: 5.023 é o
   teto das elegíveis no Senado, e só as já ingeridas entram. Configurável por variável de ambiente:
   `INGEST_CONSULTAS_MAX` (teto, padrão 500) e `INGEST_CONSULTAS_INTERVALO_MS` (intervalo, padrão
   1000). Matéria encerrada ou inexistente (redirecionamento 301/302/303/307/308) fica registrada no
   cursor `senado:consultas` e só volta à seleção depois de 30 dias, para não ocupar o teto todo dia.
   Matéria sem apuração ou cuja leitura falhou (template alterado, leitura inválida, rede/status)
   fica registrada da mesma forma por 3 dias.
   Depois de 10 falhas seguidas (rede, status, template alterado, leitura inválida) a execução
   para as consultas e loga; pulo esperado não conta e uma leitura boa zera a contagem.
7. **Endpoint oficial:** pedir ao Senado em paralelo (texto abaixo). O envio fica com quem mantém o
   projeto; o epic não depende da resposta.
8. **Novo valor em `evento_tipo`:** o push puro basta, sem linha nova em `sql/extra.sql`. Teste
   de 2026-10-28 com `drizzle-kit push --force` (PostgreSQL 16):
   - Banco vazio: cria a tabela `consulta_publica` (PK `materia_cod`, FK para `proposicao` com
     `on delete cascade`, índice em `apurado_em`) e o enum já sai com os quatro valores.
   - Banco com o schema anterior e linhas em `evento`: o drizzle emite
     `ALTER TYPE "public"."evento_tipo" ADD VALUE 'consulta_publica';` antes do `CREATE TABLE`. O
     OID do tipo não muda, e as linhas de `evento` e `parlamentar` continuam lá.

   O Postgres não deixa usar o valor novo na mesma transação que o adiciona: ingest e testes só
   gravam `consulta_publica` depois do push.
9. **PL 5064/2023 (160575) na base?** É de autoria de senador (Hamilton Mourão, casa iniciadora SF,
   objetivo "Iniciadora"), então o ingest do Senado o grava se a janela `--desde` cobrir 2023-10-19.
   A verificação da f04 roda o ingest com essa janela, ou semeia a proposição.

## Efeito por pacote

| Pacote | Mudança |
|---|---|
| `packages/core` | Aditiva: tabela `consulta_publica` (`materia_cod`, `proposicao_id`, `votos_sim`, `votos_nao`, `apurado_em`, `url_fonte`) e valor `consulta_publica` em `evento_tipo`; `FeedItemConsulta` na união `FeedItem`. |
| `apps/ingest` | `buscarTexto` em `http.ts` (mesma fila, backoff e UA); parser puro com testes e fixtures; `senado/consultas.ts` com teto e intervalo, cursor `senado:consultas`. Falha de leitura pula e loga, nunca grava zero. |
| `apps/api` | `consulta_publica` em `TIPOS` e `montarItens`; testes em `app.test.ts`. |
| `apps/web` | Card de consulta (sim e não com texto e ícone, totais pt-BR, "Votos apurados até", aviso, link oficial) e chip "Consultas". |

## Rascunho da issue (upstream)

**Título:** Consultas públicas do e-Cidadania no feed (placar sim/não do Senado)

**Corpo:**

> Proposta: mostrar no feed o placar das consultas públicas do e-Cidadania, ligado à proposição
> que já ingerimos do Senado. Antes de qualquer código, preciso saber se o coletivo aceita a fonte.
>
> **Fonte.** `www12.senado.leg.br/ecidadania/visualizacaomateria?id=<codigoMateria>`. É página
> oficial do Senado, mas sem API: o placar está no HTML renderizado no servidor. O `id` é o
> `codigoMateria` do dadosabertos, então a ligação com `proposicao` é direta. Medição e excertos do
> markup em `docs/consultas-publicas.md`.
>
> **Limites.** É enquete aberta: cada pessoa cadastrada vota uma vez, mas não é amostra e não
> representa a população. Os termos de uso não dão licença explícita nem proíbem leitura
> automatizada (só punem contas e robôs que votam); `robots.txt` libera. Todo card leva o aviso
> "Enquete aberta no e-Cidadania: cada pessoa cadastrada vota uma vez. Não representa a população."
> e o link da página oficial. Sem rótulo e sem cor por lado.
>
> **Frequência.** Até 500 páginas por execução diária, 1 por segundo, com o User-Agent do projeto.
> Uma volta completa leva no máximo ~10 dias (até ~5 mil matérias; só as que já ingerimos entram).
>
> **Efeito.** `core`: tabela nova `consulta_publica` e valor `consulta_publica` em `evento_tipo`
> (aditivo). `ingest`: leitor de HTML lento com parser estrito e os primeiros testes do pacote.
> `api`: novo tipo no feed. `web`: card de consulta e chip de filtro. O evento fica no primeiro
> signatário, no máximo um por mês por proposição, com os números congelados.
>
> **Perguntas ao coletivo.**
> 1. Placar do e-Cidadania cabe em "só dado oficial"?
> 2. Card ligado ao primeiro signatário serve, ou preferem item sem parlamentar (muda `evento`)?
> 3. O texto do aviso está bom?

## Rascunho do pedido ao Senado

Destino: Dados Abertos do Senado / Prodasen (canal "Fale com o Senado" ou contato do portal
dadosabertos).

> Assunto: Dados abertos das consultas públicas do e-Cidadania
>
> Somos um projeto sem fins lucrativos e de código aberto (Plenário,
> github.com/tonhonho/plenario) que publica dados oficiais da atividade parlamentar. Gostaríamos de
> exibir o resultado das consultas públicas do e-Cidadania junto às matérias. Hoje esse dado só
> existe na página `visualizacaomateria`, e a API de Dados Abertos não tem endpoint para ele.
>
> Pedimos, se possível, um endpoint em `legis.senado.leg.br/dadosabertos` que devolva, por
> `codigoMateria`, os votos sim e não e o instante da apuração (ou um arquivo em lote diário), com
> licença de uso explícita. Até lá, lemos a página pública com baixa frequência (1 requisição por
> segundo, User-Agent identificado) e citamos a fonte em cada exibição.
