# Feature: Reescrita multi-API, cinco documentos Swagger em main

## Declaração de intenção

Até aqui o mock só expõe a Asset API, gerada de `docs/marketo-swagger-asset.json` ([ADR 0004](../decisions/0004-swagger-as-single-source-with-committed-generated-code.md)). A Track A do lite-campaign precisa de rotas que esse documento não tem: o R3 depende de `/identity/oauth/token`, e o R4, de `/userservice/management/...`. O dono escreveu, sem commit no checkout principal, uma reescrita que gera o mock a partir de cinco documentos publicados pela Adobe: Asset, Data Ingestion, Identity, Lead Database e User Management.

Esta feature leva a reescrita para `main` pelo loop. Cada operação dos cinco documentos vira uma rota que responde no formato documentado, e o código gerado continua reproduzível pelos geradores. Rota não é comportamento: a autenticação real e o estado continuam com a Track A.

## Critérios de aceite

- [ ] Os cinco documentos têm origem, commit upstream e sha256 registrados; o arquivo de assets preserva a cópia atual.
- [ ] `scripts/marketo_codegen.py` registra os cinco alvos e os três geradores aceitam `--target`, `--swagger` e `--area`, com suporte a Swagger 2.0 e OpenAPI 3, sem sobrescrever outra área.
- [ ] Os arquivos gerados e os módulos escritos à mão cobrem as 388 operações; um teste confere método+caminho dos cinco documentos contra os controllers e detecta colisões exatas. Smoke e2e confere pelo menos uma rota de cada grupo, inclusive Identity e o 202 vazio de Data Ingestion.
- [ ] `npm run generate:all` não muda nenhum arquivo num clone limpo; `npm run check:all` passa. A correção pontual do diretório temporário do verificador entra nesta PR; os itens restantes da #7 permanecem lá.
- [ ] `npm run check`, `npm run check:context` e o e2e passam; a âncora da ADR 0004 acompanha o heading novo do README.
- [ ] Intent, atualização da ADR 0004 e dos patterns de código gerado, e Learn no changelog explicam a nova fronteira por área. O commit de output gerado é distinto dos commits de Swagger e dos geradores.
- [ ] A PR fecha somente a #6, tem revisão do Copilot na cabeça, nenhuma thread aberta e gate fresco antes do merge.

## Abordagem técnica

- **A fonte.** A reescrita sai do checkout principal por cópia controlada, sem tocar nele. Medido em 2026-09-26 sobre `610e101`: 98 arquivos modificados, 15 apagados e 522 novos. Os 620 arquivos copiados são conferidos por sha256 contra o checkout do dono antes de qualquer edição.
- **Os cinco alvos.** Cada alvo liga um documento de `docs/` a uma área de `src/`:

  | Alvo | Documento | Formato | Área | Schemas | Caminhos | Operações |
  | --- | --- | --- | --- | ---: | ---: | ---: |
  | `asset` | `marketo-swagger-asset.json` | Swagger 2.0 | `src/asset` | 255 | 186 | 220 |
  | `data-ingestion` | `marketo-swagger-data-ingestion.json` | OpenAPI 3.0.1 | `src/data-ingestion` | 15 | 7 | 7 |
  | `identity` | `marketo-swagger-identity.json` | Swagger 2.0 | `src/identity` | 2 | 1 | 2 |
  | `mapi` | `marketo-swagger-mapi.json` | Swagger 2.0 | `src/lead-database` | 175 | 129 | 147 |
  | `user` | `marketo-swagger-user.json` | Swagger 2.0 | `src/user-management` | 12 | 12 | 12 |
  | **Total** | | | | **459** | **335** | **388** |

- **A origem.** Os quatro documentos novos são, byte a byte, os blobs de `static/swagger-*.json` de AdobeDocs/marketo-apis em `89c8e262`, que era o HEAD de lá em 2026-09-26. O de assets fica como está (sha256 `ced6c339…`): os bytes diferem do blob de lá, e o JSON é o mesmo, como mediu o plano.
- **Os commits**, cada um com `Refs #6`, nesta ordem, para que todo commit compile:
  1. este intent;
  2. os quatro documentos novos;
  3. os geradores, a correção do verificador e o README, com a âncora da ADR 0004 que acompanha o heading novo;
  4. a saída regenerada por `npm run generate:all`, sem nenhum ajuste à mão, com a linha de `src/main.ts` que importa o seed do lugar novo;
  5. os módulos escritos à mão das áreas novas e a ligação delas no `AppModule`;
  6. os testes;
  7. o Learn.

  O plano punha a ligação escrita à mão no commit dos geradores, mas ali ela importaria pastas que só existem depois da regeneração ([Mover as pastas geradas sem o gerador](../knowledge/anti-patterns/moving-generated-folders-without-the-generator.md): todo commit compila).
- **A correção do verificador.** O `check_output()` gera em `.codegen-tmp/` e formata com o Prettier. O Prettier 3 lê o `.gitignore`, onde está `/.codegen-tmp/`, e por isso não formata essa pasta: a saída sem formatação parecia defasada. A correção pontual faz o Prettier dos geradores ler só o `.prettierignore`. A pasta continua fora do git.
- **Os testes.** Um e2e novo lê os documentos de `docs/`, confere as 388 operações contra as rotas que o app registra e recusa método+caminho repetido. Ele também faz um pedido por área, inclusive o token de Identity e o 202 vazio de Data Ingestion.
- **O que muda para o lite-campaign.**
  - Os 139 POSTs de assets passam a responder 200, como o Swagger declara, em vez do 201 padrão do Nest.
  - `seedMockData()` e `mockRequestId()` saem de `src/asset/asset-mocks/` e vão para `src/mocks/`.
  - 13 definições `ResponseOf*` passam de `models/` para `responses/`.
  - As 220 rotas de assets continuam na mesma ordem (medido).
- **Fora desta feature.**
  - A #7: o cabeçalho de arquivo gerado, a falha explícita sem Prettier e o `check:all` no CI.
  - A #8: a ordem das rotas. Medido: além das 11 rotas de assets, 2 rotas de `lead-database` (`GET` e `POST /rest/v1/customobjects/schema.json`) caem no handler de `/rest/v1/customobjects/:customObjectName.json`.
  - A #9: o `ObserveModule`, o nome do pacote e o Hello World.
  - A Track A: autenticação e estado.

## Decisões relacionadas

- [0004: O Swagger como fonte única, com o código gerado commitado](../decisions/0004-swagger-as-single-source-with-committed-generated-code.md)
- [0005: NestJS sobre Express, com um módulo por tag](../decisions/0005-nestjs-express-one-module-per-tag.md)
- [0006: DTOs como interfaces TypeScript](../decisions/0006-dtos-as-typescript-interfaces.md)
- [0007: Factories faker com overrides e seed](../decisions/0007-faker-factories-with-overrides-and-seed.md)
- [0009: Comportamento ao lado do código gerado, nunca dentro](../decisions/0009-behaviour-beside-generated-code.md)

## Patterns relacionados

- [Gerar e conferir](../knowledge/patterns/generate-and-check.md)
- [A fronteira do código gerado](../knowledge/patterns/generated-code-boundary.md)
- [A forma de um módulo de recurso](../knowledge/patterns/resource-module-shape.md)
- [Factory com overrides](../knowledge/patterns/factory-with-overrides.md)
- [Revisão classificada por risco](../knowledge/patterns/risk-classified-review.md)
- [Ciclo de vida de issue e branch](../knowledge/patterns/issue-branch-lifecycle.md)

## Resultados

Preenchidos no Learn desta issue.

## Status

- **Criado**: 2026-09-26 (Fase: Intent), do plano aprovado na issue #6 (#6)
- **Status**: In Progress
- **Atualizado**: 2026-09-26 (Fase: Intent), branch cortada de `origin/main` sem esperar o merge da #5, pela nova resposta do dono à pergunta 4 (#6)
