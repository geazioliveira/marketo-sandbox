# ADR 0004: O Swagger como fonte única, com o código gerado commitado

## Contexto

- O mock existe para que cada operação da API de assets do Marketo responda no formato documentado. O [project intent](../intent/project-intent.md) registra por que um simulador escrito à mão não serve: o do lite-campaign se afastou da API e foi a origem de brunohab/lite-campaign#47, #54, #60 e #61.
- **O documento de entrada** é [`docs/marketo-swagger-asset.json`](../../docs/marketo-swagger-asset.json). Ele entrou em `0c8e760`, e nenhum commit o mudou depois.
  - Swagger `2.0`, título "Marketo Engage Rest API", `version` "1.0", host `localhost:8080`, basePath `/`. O `info` não traz data nem revisão.
  - 508.259 bytes em 18.328 linhas, a última sem quebra de linha (o `wc -l` conta 18.327). sha256 `ced6c339f60e71f30f4a929ce04e748c814ca2e8350611b946af3267cb962eaf` (`shasum -a 256 docs/marketo-swagger-asset.json`).
  - 255 definições, 53 delas `ResponseOf*`.
  - 186 caminhos: 153 em `/rest/asset/v1` e 33 em `/rest/asset/v2`.
  - 220 operações e 23 tags declaradas, todas usadas.
- **O consumidor fixa outra cópia.** A ADR 0005 do lite-campaign (`context/decisions/0005-marketo-email-generations.md`, seção Sources) fixa o `swagger-asset.json` com sha256 `ff7ec62855d51a4ada4711ed7b4de3aa053b95a73467a0e45dbe29cb76868e03`, 186 caminhos e 254 definições, baixado em 2026-09-13 do repositório AdobeDocs/marketo-apis. As duas cópias contam 186 caminhos, e a do lite-campaign tem uma definição a menos.
- **No histórico.**
  - `0c8e760` traz o Swagger, os geradores de definições e de resources, os dois já com `--check` (`0c8e760:scripts/generate-marketo-definitions.py:164`, `0c8e760:scripts/generate-marketo-resources.py:275`), e 255 DTOs e 70 arquivos de resources commitados. Já nesse commit o commitado não é o que os geradores emitem: eles põem o sufixo `.js` nos imports (`0c8e760:scripts/generate-marketo-definitions.py:151`, `0c8e760:scripts/generate-marketo-resources.py:73`), e nenhum arquivo commitado o tem.
  - `01ee283` acrescenta os scripts `generate:factories`, `check:factories`, `generate:all` e `check:all`, e a seção do README que manda nunca editar a saída à mão.
  - `a967f26` faz os dois geradores importarem `marketo_codegen`, e `0ef242d` traz esse módulo e o gerador de factories.
  - `b91681a` commita a saída do gerador de factories: 259 arquivos.

## Decisão

- **Uma fonte.** Rotas, DTOs e factories saem só de `docs/marketo-swagger-asset.json`. `scripts/marketo_codegen.py:15` fixa o caminho em `SOURCE`, e `load_document()` o lê (`:19-20`).
- **Três geradores Python e um módulo comum.**

  | Gerador | Lê | Emite |
  | --- | --- | --- |
  | [`generate-marketo-definitions.py`](../../scripts/generate-marketo-definitions.py) | `document["definitions"]` (`:174`) | 255 interfaces ([ADR 0006](0006-dtos-as-typescript-interfaces.md)) |
  | [`generate-marketo-resources.py`](../../scripts/generate-marketo-resources.py) | `document["paths"]`, agrupado pela primeira tag (`:266-270`) | 23 módulos de recurso, 70 arquivos ([ADR 0005](0005-nestjs-express-one-module-per-tag.md)) |
  | [`generate-marketo-factories.py`](../../scripts/generate-marketo-factories.py) | `document["definitions"]` (`:280`) | 255 factories, `request-id.ts`, `seed.ts` e os `index.ts` ([ADR 0007](0007-faker-factories-with-overrides-and-seed.md)) |

  [`marketo_codegen.py`](../../scripts/marketo_codegen.py) guarda o que os três compartilham: a fonte, os nomes, a escrita, a conferência e o Prettier.
- **Gerar reescreve a pasta inteira.** `write_output` apaga a pasta de saída com `shutil.rmtree` e formata o resultado com o Prettier de `node_modules` (`scripts/marketo_codegen.py:92-101`).
- **Todo gerador tem `--check`.** O argumento está em `generate-marketo-definitions.py:171`, `generate-marketo-resources.py:287` e `generate-marketo-factories.py:302`. `check_output` (`scripts/marketo_codegen.py:104-132`) gera em `.codegen-tmp`, formata, compara arquivo a arquivo com os arquivos da árvore e aponta todo `*.ts` a mais na pasta. Qualquer diferença sai com 1.
- **Os scripts npm.** `generate:{definitions,resources,factories,all}` e `check:{definitions,resources,factories,all}` (`package.json:11-18`). `check:all` encadeia os três `--check` (`package.json:18`).
- **O código gerado é commitado**: 255 arquivos em `src/asset/asset-definitions/`, 70 em `src/asset/resources/` e 259 em `src/asset/asset-mocks/`.
- **Ninguém edita a saída à mão.** O [README](../../README.md#mock-marketo-api) diz, desde `01ee283`, que essas pastas são geradas do Swagger e que nunca se editam à mão: regenera-se (`README.md:60-61`). E indica `npm run check:all` para o CI (`README.md:73-74`).

## Racional

- **Fonte única contra deriva.** O project intent pede um único serviço, gerado a partir do Swagger oficial, em que toda rota documentada existe e responde no formato documentado. Um simulador à mão se afasta da API, como aconteceu no lite-campaign.
- **Commitar a saída.** O `--check` pressupõe isso: ele compara os arquivos da árvore com o que o gerador emite (`scripts/marketo_codegen.py:117-122`), e o README o indica para o CI (`README.md:73-74`), onde a árvore é o commit. Commitar também deixa o mock compilar e rodar sem Python (inferido; confirmar), e deixa a revisão ver como diff o efeito de uma mudança no Swagger ou num gerador (inferido; confirmar).
- **`--check` em vez de confiança.** A saída pode se afastar da fonte por uma edição à mão ou por um gerador mudado sem regenerar. O `--check` mostra isso num comando, e o README o indica para o CI.
- **Geradores próprios.** A saída segue uma forma que é deste projeto: um módulo Nest por tag e factories faker. Um gerador genérico não a emitiria (inferido; confirmar).

## Alternativas consideradas

O histórico não registra alternativas. As linhas abaixo são as óbvias, com o motivo marcado quando é inferido.

| Opção | Por que não |
| --- | --- |
| Rotas e DTOs escritos à mão | É o simulador que o project intent aponta como fonte de defeitos no lite-campaign |
| Gerar no build, sem commitar a saída | O build passaria a exigir Python, e a revisão não veria o código que roda (inferido; confirmar) |
| Montar as rotas do Swagger em runtime | Sem tipos em tempo de compilação para os DTOs, e sem um arquivo por recurso onde pôr comportamento (inferido; confirmar) |
| Um gerador genérico, como o openapi-generator | Não emite a forma Nest nem as factories faker que o projeto usa (inferido; confirmar) |

## Consequências

- **Mais fácil**:
  - uma mudança no Swagger vira um `npm run generate:all` e um diff revisável;
  - o `check:all` diz, num comando, se o código commitado ainda é o que a fonte gera;
  - o sha256 registrado aqui diz qual cópia gerou o código de `main`.
- **Mais difícil**:
  - **Hoje o `check:all` não passa (#7).** Dois geradores ainda escrevem no layout anterior a `e7a0bb6`, com as pastas direto em `src/`: o `OUTPUT` de definições é `src/asset-definitions` (`scripts/generate-marketo-definitions.py:23`) e o de factories é `src/asset-mocks` (`scripts/generate-marketo-factories.py:27`), mas os arquivos commitados estão em `src/asset/`. O de resources acerta a pasta (`scripts/generate-marketo-resources.py:30`), mas emite imports `../../../` (`:59`, `:63`), e os arquivos commitados usam `../../`.
  - Rodados numa cópia de `origin/main`, os três `--check` saem com 1: definições com 255 arquivos ausentes ou mudados, resources com 46 mudados (os 23 controllers e os 23 services, só no prefixo dos imports) e factories com 259 ausentes.
  - Fora do caminho, o conteúdo bate. Gerados na mesma cópia, os 255 arquivos de definições e os 259 de factories saem idênticos aos commitados (`diff -r` vazio), só em outra pasta.
  - A causa está no histórico: `e7a0bb6` moveu as definições para `src/asset/` sem mudar o gerador, e `b91681a` commitou as factories em `src/asset/asset-mocks/`, fora da pasta que o gerador delas escreve ([Anti-pattern: Mover as pastas geradas sem o gerador](../knowledge/anti-patterns/moving-generated-folders-without-the-generator.md)). E `5cc5e09` mudou a saída sem o gerador, com um prefixo de import que nenhuma versão dele emite ([Anti-pattern: Editar código gerado à mão](../knowledge/anti-patterns/hand-editing-generated-code.md)).
  - Pelo mesmo motivo, um `generate:all` hoje recriaria as pastas no layout antigo, ao lado das atuais (#7).
  - Sem `node_modules`, o Prettier é pulado em silêncio (`scripts/marketo_codegen.py:82`), e um arquivo que só difere na formatação aparece como mudado (#7). Medido na #4: sem `node_modules`, o `check:resources` continua acusando os mesmos 46 arquivos.
  - Nenhum arquivo gerado diz que é gerado nem de qual sha256 veio. A regra de não editar vive no README e nesta ADR, e o critério do project intent "O mock registra qual cópia do Swagger o gerou (sha256)" continua aberto.
- **Qual cópia vale é decisão em aberto** do [project intent](../intent/project-intent.md#decisões-em-aberto): `ced6c339…` aqui, `ff7ec628…` no lite-campaign. A escolha sai de um diff nas rotas que o consumidor usa. Até lá, esta ADR registra a cópia que gerou o código de `main`, sem dizer que ela é a certa.
- **A reescrita multi-API (#6) troca a fonte única por várias.** Ela traz um registro de alvos em `scripts/marketo_codegen.py`, novos documentos em `docs/`, suporte a OpenAPI 3 e áreas novas em `src/`. A regra desta ADR passaria a valer por documento: cada área sai do seu Swagger e tem o seu `--check` (inferido; confirmar). A PR da #6 atualiza esta ADR ou a substitui.

## Relacionados

- [ADR 0005: NestJS sobre Express, com um módulo por tag](0005-nestjs-express-one-module-per-tag.md), a forma da saída do gerador de resources
- [ADR 0006: DTOs como interfaces TypeScript](0006-dtos-as-typescript-interfaces.md), a forma da saída do gerador de definições
- [ADR 0007: Factories faker com overrides e seed](0007-faker-factories-with-overrides-and-seed.md), a forma da saída do gerador de factories
- [ADR 0008: A toolchain](0008-toolchain.md), com o Python e o Prettier que os geradores usam
- [ADR 0009: Comportamento ao lado do código gerado, nunca dentro](0009-behaviour-beside-generated-code.md), que decorre desta
- [Pattern: Gerar e conferir](../knowledge/patterns/generate-and-check.md)
- [Pattern: A fronteira do código gerado](../knowledge/patterns/generated-code-boundary.md)
- [Anti-pattern: Editar código gerado à mão](../knowledge/anti-patterns/hand-editing-generated-code.md)
- [Anti-pattern: Mover as pastas geradas sem o gerador](../knowledge/anti-patterns/moving-generated-folders-without-the-generator.md)
- [Project intent](../intent/project-intent.md) e [Feature: Registro retroativo do projeto](../intent/feature-retroactive-record.md)
- Os geradores no layout antigo (#7) e a reescrita multi-API (#6)

## Status

- **Criado**: 2026-09-25 (Fase: Build), registro retroativo de `0c8e760`..`fb4a804` (#4)
- **Status**: Accepted
