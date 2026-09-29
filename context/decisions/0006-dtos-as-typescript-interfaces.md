# ADR 0006: DTOs como interfaces TypeScript

## Contexto

- As 255 definições do Swagger de assets precisam de um tipo TypeScript ([ADR 0004](0004-swagger-as-single-source-with-committed-generated-code.md)). Os controllers os usam nos parâmetros e nos retornos ([ADR 0005](0005-nestjs-express-one-module-per-tag.md)), e as factories nos overrides ([ADR 0007](0007-faker-factories-with-overrides-and-seed.md)).
- **No histórico.**
  - `0c8e760` traz as 255 interfaces em `src/asset-definitions/` e o gerador `scripts/generate-marketo-definitions.py`, que já emite cada definição como `export interface` (`0c8e760:scripts/generate-marketo-definitions.py:142`). Os arquivos commitados não têm o sufixo `.js` que esse gerador põe nos imports (`:151`) ([ADR 0004](0004-swagger-as-single-source-with-committed-generated-code.md)).
  - `a19d9d3` apaga 101 delas como "não usadas", e `e7a0bb6` traz de volta os mesmos 101 caminhos e move as 255 para `src/asset/asset-definitions/`. Os dois commits são as duas metades de uma mudança de pasta ([Anti-pattern: Mensagem de commit que diz menos do que o commit faz](../knowledge/anti-patterns/commit-message-understating-its-content.md)).
  - `e7a0bb6` também reformata os arquivos no estilo do Prettier, sem ponto e vírgula e com aspas simples. A forma não muda: continuam interfaces.
- **A #6 levou os DTOs a cinco áreas**, com um documento Swagger por área, um deles em OpenAPI 3 ([ADR 0004](0004-swagger-as-single-source-with-committed-generated-code.md)).

## Decisão

- **Todo DTO é uma `export interface`.** São 255, e nenhuma classe, em `src/asset/asset-definitions/`: 92 em `models/`, 72 em `requests/` e 91 em `responses/`. Desde a #24, uma definição de topo sem membros, como um array, é um alias de tipo ([ADR 0013](0013-top-level-definitions-without-members-as-type-aliases.md)).
- **A pasta sai do sufixo do nome.** `*Request` vai para `requests/`, `*Response` para `responses/` e o resto para `models/` (`category()`, `610e101:scripts/generate-marketo-definitions.py:27-32`). Os geradores de resources e de factories montam os imports com uma cópia da mesma regra, `definition_category()` (`610e101:scripts/marketo_codegen.py:41-46`).
- **Como o gerador emite**, em `render()` (`610e101:scripts/generate-marketo-definitions.py:101-152`):
  - um `allOf` com `$ref` vira `extends` (`:108-115`, `:142`);
  - um enum de propriedade vira um alias de tipo exportado, `export type <Nome><Propriedade>` (`:130-135`), como `ProgramResponseStatus` e `ProgramResponseType` (`src/asset/asset-definitions/responses/program-response.ts:8-9`);
  - uma propriedade fora de `required` ganha `?` (`:139`);
  - a `description` do Swagger vira JSDoc (`:137-138`);
  - as dependências entram com `import type` (`:123`).

  Dois exemplos: `src/asset/asset-definitions/responses/program-response.ts:4-15` e `src/asset/asset-definitions/models/folder.ts:4-15`.
- **Desde a #6, 459 interfaces nas cinco áreas**, em `src/<área>/<área>-definitions/`. A regra da pasta é uma só, `definition_category()`, que os três geradores usam, e um nome que começa com `ResponseOf` também vai para `responses/` (`scripts/marketo_codegen.py:179-185`). Por isso 13 definições de assets passaram de `models/` para `responses/`, e ficaram 79 em `models/`, 72 em `requests/` e 104 em `responses/`. O OpenAPI 3 passa pelo mesmo `render()`: os schemas vêm de `components.schemas` (`scripts/marketo_codegen.py:57-60`).
- **Sem biblioteca de validação.** class-validator e class-transformer não aparecem em `src` nem em `test`, e não estão instalados. No `package-lock.json`, são só peers opcionais de `@nestjs/common` (`:702-703`), de `@nestjs/mapped-types` (`:765-766`) e de `@nestjs/swagger` (`:846-847`).

## Racional

- **Só tipo.** Uma interface existe só em tempo de compilação. Um DTO que tipa uma resposta de mock e um parâmetro que o service ignora não precisa de mais que isso (inferido; confirmar).
- **`allOf` como `extends`.** A composição do Swagger continua visível no tipo, e um campo herdado não se repete (inferido; confirmar).
- **Alias de tipo, não `enum`.** Um union de literais casa com o valor como ele vem no JSON e não gera objeto em runtime (inferido; confirmar).
- **Opcional salvo `required`.** É a leitura literal do contrato: o que o Swagger não exige, o tipo não exige (inferido; confirmar).

## Alternativas consideradas

O histórico não registra alternativas. As linhas abaixo são as óbvias, e cada motivo é inferido.

| Opção | Por que não |
| --- | --- |
| Classes com class-validator e class-transformer | Duas dependências e decorators em cada campo, para um mock que até aqui só devolve dados (inferido; confirmar) |
| Classes com `@ApiProperty` | Dariam schemas à UI em `/api`, mas o `@nestjs/swagger` só entrou em `01ee283`, depois das interfaces de `0c8e760` (inferido; confirmar) |
| Schemas de runtime gerados do Swagger, como zod | Uma dependência e um segundo formato para manter em sincronia com o gerador (inferido; confirmar) |
| `enum` do TypeScript para os enums | Gera um objeto em runtime, e um literal vindo do JSON não é atribuível a ele sem conversão (inferido; confirmar) |

## Consequências

- **Mais fácil**:
  - os tipos não custam nada em runtime, e o gerador fica simples: um arquivo por definição;
  - `Partial<X>` sobre a interface é o tipo dos overrides das factories ([ADR 0007](0007-faker-factories-with-overrides-and-seed.md));
  - o JSDoc leva a descrição do Swagger para o editor.
- **Mais difícil**:
  - **Nenhuma validação em runtime.** Um corpo ou um parâmetro fora do contrato chega ao service como veio. Não há pipe nos parâmetros (`src/asset/resources/snippets/snippets.controller.ts:30`), nem `ValidationPipe`, nem class-validator em `src`.
  - **A validação estrita da Track A vai precisar de outra coisa.** O project intent a lista entre os [critérios de aceite](../intent/project-intent.md#critérios-de-aceite). Uma interface não existe em runtime, então a validação precisa de código de runtime. A [ADR 0009](0009-behaviour-beside-generated-code.md), ainda `Proposed`, o põe ao lado do código gerado, nunca dentro dele. A forma da validação ainda não foi decidida.
  - **A UI do Swagger sai sem schemas.** O `@nestjs/swagger` monta o documento de `/api` e `/api-json` a partir das rotas e dos decorators do app (`src/main.ts:17-18`, `README.md:39-42`), não de `docs/marketo-swagger-asset.json`. Não há nenhum `@Api*` em `src`, e o `nest-cli.json` não liga o plugin do `@nestjs/swagger`. Medido na #4 numa cópia de `origin/main` compilada com `tsc`: o `SwaggerModule.createDocument` sobre o `AssetResourcesModule` devolve 186 caminhos e 0 schemas.
  - **Da #6 à #24, um schema de topo sem `properties` virava interface vazia.** `Person` e `CustomObject`, do Data Ingestion, só têm `additionalProperties`, e `LeadAttribute2SearchableFields`, de Lead Database, é um array de strings. Os três saíam como `export interface X {}`, o tipo aceitava qualquer objeto, e a factory devolvia `{}` (medido na #6). Desde a #24, os três são aliases de tipo, `Record<string, unknown>` e `Array<string>` ([ADR 0013](0013-top-level-definitions-without-members-as-type-aliases.md)).
  - **O tipo não garante o envelope.** Todo campo do envelope é opcional (`src/asset/asset-definitions/responses/response-of-snippet-response.ts:7-13`), então o tipo aceita um envelope sem `success`. Só a factory garante que ele vem preenchido ([ADR 0007](0007-faker-factories-with-overrides-and-seed.md)).

## Relacionados

- [ADR 0004: O Swagger como fonte única, com o código gerado commitado](0004-swagger-as-single-source-with-committed-generated-code.md), de onde vêm as definições
- [ADR 0005: NestJS sobre Express, com um módulo por tag](0005-nestjs-express-one-module-per-tag.md), que usa os DTOs nos controllers e services
- [ADR 0007: Factories faker com overrides e seed](0007-faker-factories-with-overrides-and-seed.md), que usa os DTOs nos overrides
- [ADR 0009: Comportamento ao lado do código gerado, nunca dentro](0009-behaviour-beside-generated-code.md), que propõe onde a validação estrita entra
- [ADR 0013: Definição de topo sem membros vira alias de tipo, e a factory dela devolve o valor inteiro](0013-top-level-definitions-without-members-as-type-aliases.md), que emenda esta decisão
- [Pattern: A fronteira do código gerado](../knowledge/patterns/generated-code-boundary.md)
- [Anti-pattern: Mensagem de commit que diz menos do que o commit faz](../knowledge/anti-patterns/commit-message-understating-its-content.md)
- [Project intent](../intent/project-intent.md)

## Status

- **Criado**: 2026-09-25 (Fase: Build), registro retroativo de `0c8e760`..`fb4a804` (#4)
- **Status**: Accepted
- **Atualizado**: 2026-09-26 (Fase: Learn), as citações do `src/main.ts`, do `README.md` e do `package-lock.json` seguiram as linhas novas depois da #9 (#9)
- **Atualizado**: 2026-09-26 (Fase: Learn), 459 interfaces nas cinco áreas, uma regra só de pasta, com `ResponseOf*` em `responses/`, e os schemas do OpenAPI 3; as citações da regra de pasta e do `render()` de antes da #6 passaram a levar o commit `610e101` (#6)
- **Atualizado**: 2026-09-26 (Fase: Build), as citações dos arquivos gerados e dos geradores seguiram as linhas novas, depois do cabeçalho de gerado (#7)
- **Atualizado**: 2026-09-28 (Fase: Build), uma definição de topo sem membros passou a ser um alias de tipo, pela ADR 0013, e as citações dos geradores seguiram as linhas novas (#24)
