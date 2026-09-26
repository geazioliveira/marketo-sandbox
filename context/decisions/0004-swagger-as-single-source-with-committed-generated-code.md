# ADR 0004: O Swagger como fonte única, com o código gerado commitado

## Contexto

- O mock existe para que cada operação documentada do Marketo responda no formato documentado. O [project intent](../intent/project-intent.md) registra por que um simulador escrito à mão não serve: o do lite-campaign se afastou da API e foi a origem de brunohab/lite-campaign#47, #54, #60 e #61.
- **O primeiro documento de entrada** foi [`docs/marketo-swagger-asset.json`](../../docs/marketo-swagger-asset.json). Ele entrou em `0c8e760`, e nenhum commit o mudou depois.
  - Swagger `2.0`, título "Marketo Engage Rest API", `version` "1.0", host `localhost:8080`, basePath `/`. O `info` não traz data nem revisão.
  - 508.259 bytes em 18.328 linhas, a última sem quebra de linha (o `wc -l` conta 18.327). sha256 `ced6c339f60e71f30f4a929ce04e748c814ca2e8350611b946af3267cb962eaf` (`shasum -a 256 docs/marketo-swagger-asset.json`).
  - 255 definições, 53 delas `ResponseOf*`.
  - 186 caminhos: 153 em `/rest/asset/v1` e 33 em `/rest/asset/v2`.
  - 220 operações e 23 tags declaradas, todas usadas.
- **O consumidor fixa outra cópia.** A ADR 0005 do lite-campaign (`context/decisions/0005-marketo-email-generations.md`, seção Sources) fixa o `swagger-asset.json` com sha256 `ff7ec62855d51a4ada4711ed7b4de3aa053b95a73467a0e45dbe29cb76868e03`, 186 caminhos e 254 definições, baixado em 2026-09-13 do repositório AdobeDocs/marketo-apis. As duas cópias contam 186 caminhos, e a do lite-campaign tem uma definição a menos.
- **A Track A precisa de mais que assets (#6).** O R3 depende de `/identity/oauth/token`, e o R4, de `/userservice/management/...`, e nenhum dos dois está no Swagger de assets. A Adobe publica um documento por API em `static/` de AdobeDocs/marketo-apis. O dono escreveu, sem commit no checkout principal, uma reescrita dos geradores para cinco deles, e a #6 a trouxe para `main`.
- **No histórico.**
  - `0c8e760` traz o Swagger, os geradores de definições e de resources, os dois já com `--check` (`0c8e760:scripts/generate-marketo-definitions.py:164`, `0c8e760:scripts/generate-marketo-resources.py:275`), e 255 DTOs e 70 arquivos de resources commitados. Já nesse commit o commitado não é o que os geradores emitem: eles põem o sufixo `.js` nos imports (`0c8e760:scripts/generate-marketo-definitions.py:151`, `0c8e760:scripts/generate-marketo-resources.py:73`), e nenhum arquivo commitado o tem.
  - `01ee283` acrescenta os scripts `generate:factories`, `check:factories`, `generate:all` e `check:all`, e a seção do README que manda nunca editar a saída à mão.
  - `a967f26` faz os dois geradores importarem `marketo_codegen`, e `0ef242d` traz esse módulo e o gerador de factories.
  - `b91681a` commita a saída do gerador de factories: 259 arquivos.
  - Até a #6, o `check:all` não passava (#7): dois geradores escreviam no layout anterior a `e7a0bb6`, com as pastas direto em `src/`, e o de resources emitia imports `../../../` onde os arquivos commitados tinham `../../` ([Anti-pattern: Mover as pastas geradas sem o gerador](../knowledge/anti-patterns/moving-generated-folders-without-the-generator.md), [Anti-pattern: Editar código gerado à mão](../knowledge/anti-patterns/hand-editing-generated-code.md)). As citações desta ADR ao código de antes da #6 levam o commit `610e101`.

## Decisão

- **Uma fonte por área.** Rotas, DTOs e factories de uma área saem só do documento do alvo dela. O registro `TARGETS` liga cada alvo a um documento de `docs/` e a uma área de `src/` (`scripts/marketo_codegen.py:61-70`):

  | Alvo | Documento | Formato | Área | Schemas | Caminhos | Operações | Tags |
  | --- | --- | --- | --- | ---: | ---: | ---: | ---: |
  | `asset` | `marketo-swagger-asset.json` | Swagger 2.0 | `src/asset` | 255 | 186 | 220 | 23 |
  | `data-ingestion` | `marketo-swagger-data-ingestion.json` | OpenAPI 3.0.1 | `src/data-ingestion` | 15 | 7 | 7 | 5 |
  | `identity` | `marketo-swagger-identity.json` | Swagger 2.0 | `src/identity` | 2 | 1 | 2 | 1 |
  | `mapi` | `marketo-swagger-mapi.json` | Swagger 2.0 | `src/lead-database` | 175 | 129 | 147 | 19 |
  | `user` | `marketo-swagger-user.json` | Swagger 2.0 | `src/user-management` | 12 | 12 | 12 | 1 |
  | **Total** | | | | **459** | **335** | **388** | **49** |

- **Cada documento tem origem fixada.** Os quatro novos são, byte a byte, os blobs de AdobeDocs/marketo-apis no commit `89c8e262f9e7a5498afe5199bbb85cbfee108fb3`, que era o HEAD de lá em 2026-09-26. O de assets continua a cópia de `0c8e760`.

  | Documento | Blob em `static/` de AdobeDocs | sha256 da cópia daqui |
  | --- | --- | --- |
  | `marketo-swagger-asset.json` | `swagger-asset.json`, `636777d`; a cópia daqui é o blob `780a6b4` | `ced6c339f60e71f30f4a929ce04e748c814ca2e8350611b946af3267cb962eaf` |
  | `marketo-swagger-data-ingestion.json` | `swagger-data-ingestion.json`, `2ab618c` | `2f3ba3bc17bcb7de59f21650d756445e5212eb6024b237c57afe3d35d4d33242` |
  | `marketo-swagger-identity.json` | `swagger-identity.json`, `15881d7` | `f888b2672b2367a4763c99616239b982c1425943a4ec70fdc85fd0368885c64f` |
  | `marketo-swagger-mapi.json` | `swagger-mapi.json`, `3443bb3` | `de325567504f39c4e7474384dc261033fd3f536096e88da378ed30231404dd47` |
  | `marketo-swagger-user.json` | `swagger-user.json`, `9834ad0` | `ce79d278e9bfa0029d0087a70701aee232c205d81c1f839262a75e77586d46e3` |

  O `swagger-asset.json` de lá tem 508.267 bytes e sha256 `a0f334687b3d99ae421a45cdda028e8de3ed6ade59db1fb8fd75f6822edf7fd0`. Os bytes diferem só em espaços no fim de duas linhas, e o JSON é o mesmo, inclusive na ordem das chaves: a cópia daqui fica, e nenhum código gerado muda por ela.
- **Três geradores e um módulo comum.**

  | Gerador | Lê, por alvo | Emite, por área |
  | --- | --- | --- |
  | [`generate-marketo-definitions.py`](../../scripts/generate-marketo-definitions.py) | `Target.schemas()`: `definitions` no Swagger 2.0, `components.schemas` no OpenAPI 3 (`scripts/marketo_codegen.py:55-58`) | Uma interface por schema em `src/<área>/<área>-definitions/` ([ADR 0006](0006-dtos-as-typescript-interfaces.md)) |
  | [`generate-marketo-resources.py`](../../scripts/generate-marketo-resources.py) | `operations()`, agrupadas pela primeira tag (`scripts/generate-marketo-resources.py:340-356`) | Um módulo por tag em `src/<área>/resources/` e o `<Área>ResourcesModule` ([ADR 0005](0005-nestjs-express-one-module-per-tag.md)) |
  | [`generate-marketo-factories.py`](../../scripts/generate-marketo-factories.py) | `Target.schemas()` | Uma factory por schema em `src/<área>/<área>-mocks/`, e o `seed.ts` e o `request-id.ts` comuns em `src/mocks/` ([ADR 0007](0007-faker-factories-with-overrides-and-seed.md)) |

  [`marketo_codegen.py`](../../scripts/marketo_codegen.py) guarda o que os três compartilham: o registro, as flags, a leitura dos dois formatos, os nomes, os imports relativos, a escrita, a conferência e o Prettier.
- **Swagger 2.0 e OpenAPI 3.** Um corpo vem do `schema` do Swagger 2.0 ou do `content` do OpenAPI 3, com `application/json` primeiro (`media_schema()`, `scripts/marketo_codegen.py:117-125`). O `requestBody` do OpenAPI 3 vira um parâmetro `body` (`operation_parameters()`, `:128-141`), e as respostas 2xx são lidas pelo mesmo caminho (`success_schemas()`, `:144-150`).
- **As flags.** Cada gerador aceita `--target` com um ou mais alvos (o padrão é `all`), ou `--swagger` com `--area` para um documento fora do registro (`scripts/marketo_codegen.py:75-97`). Um alvo só escreve na própria área e em `src/mocks/`: medido na #6, gerar só `identity`, ou um documento avulso numa área nova, não muda nenhum arquivo de outra área.
- **Os imports saem dos caminhos.** `relative_import()` calcula o caminho de um arquivo gerado até outro (`scripts/marketo_codegen.py:153-156`), e nenhum gerador escreve um prefixo como `../../` à mão.
- **Gerar reescreve a pasta da área.** `write_output` apaga a pasta de saída com `shutil.rmtree` e formata o resultado com o Prettier de `node_modules` (`scripts/marketo_codegen.py:240-249`).
- **Todo gerador tem `--check`.** `check_output` (`scripts/marketo_codegen.py:252-280`) gera em `.codegen-tmp`, formata, compara arquivo a arquivo com os arquivos da árvore e aponta todo `*.ts` a mais na pasta. Qualquer diferença sai com 1. O Prettier dos geradores lê só o `.prettierignore` (`:229-233`): o Prettier 3 também lê o `.gitignore`, onde `/.codegen-tmp/` está (`.gitignore:41`), e sem isso o `--check` compararia a saída sem formatação com os arquivos formatados.
- **Os scripts npm.** `generate:{definitions,resources,factories,all}` e `check:{definitions,resources,factories,all}` (`package.json:11-18`), todos com todos os alvos por padrão. `check:all` encadeia os três `--check` (`package.json:18`).
- **O código gerado é commitado**: 1.083 arquivos.

  | Área | Definições | Resources | Mocks |
  | --- | ---: | ---: | ---: |
  | `src/asset` | 255 | 70 | 257 |
  | `src/data-ingestion` | 15 | 16 | 17 |
  | `src/identity` | 2 | 4 | 4 |
  | `src/lead-database` | 175 | 58 | 177 |
  | `src/user-management` | 12 | 4 | 14 |
  | `src/mocks` | | | 3 |

- **Ninguém edita a saída à mão.** O [README](../../README.md#mock-marketo-api) diz que as pastas geradas de cada área nunca se editam à mão: regenera-se (`README.md:71-72`). Ele indica `npm run check:all` para o CI (`README.md:90-91`) e diz como registrar um documento novo (`README.md:101-103`).

## Racional

- **Fonte única contra deriva.** O project intent pede um único serviço, gerado a partir do Swagger oficial, em que toda rota documentada existe e responde no formato documentado. Um simulador à mão se afasta da API, como aconteceu no lite-campaign.
- **Uma área por documento.** Os cinco documentos repetem nomes. Medido na #6: 7 schemas aparecem em mais de um (`Company`, `CustomObject`, `Error`, `ErrorResponse`, `Lead`, `ListOperationRequest` e `ProgramMember`), e 4 tags também (`Static Lists`, `Custom Objects`, `Companies` e `Program Members`). Numa pasta só, dois arquivos teriam o mesmo nome, e as áreas separadas guardam cada um.
- **Um registro, não cinco geradores.** Um alvo novo é uma linha em `TARGETS`, e os três geradores o pegam (`README.md:101-103`).
- **Commitar a saída.** O `--check` pressupõe isso: ele compara os arquivos da árvore com o que o gerador emite (`scripts/marketo_codegen.py:265-270`), e o README o indica para o CI (`README.md:90-91`), onde a árvore é o commit. Commitar também deixa o mock compilar e rodar sem Python (inferido; confirmar), e deixa a revisão ver como diff o efeito de uma mudança no Swagger ou num gerador (inferido; confirmar).
- **`--check` em vez de confiança.** A saída pode se afastar da fonte por uma edição à mão ou por um gerador mudado sem regenerar. O `--check` mostra isso num comando.
- **Geradores próprios.** A saída segue uma forma que é deste projeto: um módulo Nest por tag e factories faker. Um gerador genérico não a emitiria (inferido; confirmar).
- **A cópia de assets fica.** Trocá-la pelo blob atual da Adobe mudaria só espaços, sem mudar nenhum arquivo gerado, e trocaria o sha256 que o lite-campaign compara com o dele.

## Alternativas consideradas

O histórico não registra alternativas para a decisão de `0c8e760`. As linhas abaixo são as óbvias, com o motivo marcado quando é inferido.

| Opção | Por que não |
| --- | --- |
| Rotas e DTOs escritos à mão | É o simulador que o project intent aponta como fonte de defeitos no lite-campaign |
| Gerar no build, sem commitar a saída | O build passaria a exigir Python, e a revisão não veria o código que roda (inferido; confirmar) |
| Montar as rotas do Swagger em runtime | Sem tipos em tempo de compilação para os DTOs, e sem um arquivo por recurso onde pôr comportamento (inferido; confirmar) |
| Um gerador genérico, como o openapi-generator | Não emite a forma Nest nem as factories faker que o projeto usa (inferido; confirmar) |
| Os cinco documentos numa área só | 7 schemas e 4 tags se repetem entre eles, e os arquivos colidiriam |
| Um conjunto de geradores por documento | Cinco cópias do mesmo código para manter em sincronia; o registro dá o mesmo com uma linha por alvo |
| Trocar a cópia de assets pelo blob atual da Adobe | O JSON é o mesmo, e o sha256 que o lite-campaign compara mudaria sem motivo |

## Consequências

- **Mais fácil**:
  - uma mudança num Swagger vira um `npm run generate:all` e um diff revisável, só na área dele;
  - o `check:all` diz, num comando, se o código commitado ainda é o que os cinco documentos geram. Medido na #6: ele sai com 0 num clone limpo, e o `generate:all` não muda nenhum arquivo;
  - um documento novo entra com uma linha em `TARGETS`, um módulo escrito à mão e uma linha no `AppModule`;
  - o sha256 de cada documento, registrado aqui, diz qual cópia gerou o código de `main`.
- **Mais difícil**:
  - **O CI ainda não roda o `check:all` (#7).** Ele fica fora do `npm run check` e do `Qualidade / check` até a #7, que também põe um cabeçalho de "gerado" nos arquivos e faz o gerador falhar sem o Prettier. Sem `node_modules`, o Prettier ainda é pulado em silêncio (`scripts/marketo_codegen.py:227-228`), e um arquivo que só difere na formatação aparece como mudado.
  - Nenhum arquivo gerado diz que é gerado nem de qual sha256 veio. A regra de não editar vive no README e nesta ADR, e o critério do project intent "O mock registra qual cópia do Swagger o gerou (sha256)" continua aberto.
  - **Um schema só com `additionalProperties` vira interface vazia.** `Person` e `CustomObject`, do Data Ingestion, saem como `export interface X {}` ([ADR 0006](0006-dtos-as-typescript-interfaces.md)).
  - **O Data Ingestion muda de host.** Na Adobe ele fica em `https://mkto-ingestion-api.adobe.io` (o `servers` do documento); no mock, no mesmo servidor das outras áreas, sob `/subscriptions/{munchkinId}/...`.
  - **Nada confere que uma área registrada tem pasta, nem o contrário.** Um alvo tirado de `TARGETS` deixa a pasta dele para trás sem que o `check:all` acuse, e uma área gerada com `--swagger` e `--area` fica fora do `check:all`. O e2e da #6 pega uma área registrada que não responde (`test/marketo-api.e2e-spec.ts`).
- **Qual cópia de assets vale é decisão em aberto** do [project intent](../intent/project-intent.md#decisões-em-aberto): `ced6c339…` aqui, `ff7ec628…` no lite-campaign. A escolha sai de um diff nas rotas que o consumidor usa. Até lá, esta ADR registra a cópia que gerou o código de `main`, sem dizer que ela é a certa.

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
- [Project intent](../intent/project-intent.md), [Feature: Registro retroativo do projeto](../intent/feature-retroactive-record.md) e [Feature: Reescrita multi-API, cinco documentos Swagger em main](../intent/feature-multi-api-targets.md)
- O `check:all` no CI e o cabeçalho de gerado (#7), e a reescrita multi-API (#6)

## Status

- **Criado**: 2026-09-25 (Fase: Build), registro retroativo de `0c8e760`..`fb4a804` (#4)
- **Status**: Accepted
- **Atualizado**: 2026-09-26 (Fase: Learn), a fonte passou a ser um documento por área, com os cinco alvos de `TARGETS`, a origem e o sha256 de cada documento, o suporte a OpenAPI 3 e o `check:all` passando (#6)
