# ADR 0007: Factories faker com overrides e seed

## Contexto

- O mock existe para que toda rota documentada responda no formato documentado, sem uma instância Marketo ([project intent](../intent/project-intent.md)). Cada um dos 220 métodos de serviço precisa de um corpo de resposta com a forma certa.
- No `0c8e760`, os 23 serviços só lançavam `NotImplementedException` (`0c8e760:src/asset/resources/snippets/snippets.service.ts`), e `@faker-js/faker` já estava nas `devDependencies` (`0c8e760:package.json:35`).
- O Swagger de assets tem 255 definições, 53 delas `ResponseOf*`, todas com o envelope `{errors, requestId, result, success, warnings}` ([ADR 0004](0004-swagger-as-single-source-with-committed-generated-code.md), [ADR 0006](0006-dtos-as-typescript-interfaces.md)). Nenhuma definição traz um `example` próprio: só uma propriedade traz, `folder` de `TokenResponse` (1 das 1.345 propriedades de topo), e nenhuma resposta das 220 operações traz `examples`, medido com node no `docs/marketo-swagger-asset.json`.
- **Como chegou, em quatro commits de 2026-09-24:**
  - `5cc5e09` trocou cada stub por `return makeX()`, importando `../../asset-mocks/factories/*`, antes de as factories existirem;
  - `0ef242d` trouxe o gerador, [scripts/generate-marketo-factories.py](../../scripts/generate-marketo-factories.py) (311 linhas);
  - `b91681a` gerou os 259 arquivos de `src/asset/asset-mocks/`: 255 factories, `factories/index.ts`, `request-id.ts`, `seed.ts` e `index.ts`;
  - `fb4a804` chamou `seedMockData()` no boot (`fb4a804:src/main.ts:7`).

## Decisão

- **Uma factory por definição.** Para cada definição do Swagger, o gerador emite um `factories/<kebab>.ts` (`scripts/generate-marketo-factories.py:283`) com `makeX(overrides: Partial<X> = {}): X`. Ela devolve um objeto completo e espalha `...overrides` por último (`:215-223`). Os arquivos commitados estão em `src/asset/asset-mocks/factories/`. Exemplo: `src/asset/asset-mocks/factories/snippet-response.ts:5-19`.
- **Tipada pelo DTO.** A factory importa o tipo da interface gerada (`scripts/generate-marketo-factories.py:209`) e o devolve, então o typecheck recusa uma factory que se afasta do DTO ([ADR 0006](0006-dtos-as-typescript-interfaces.md)).
- **O valor sai da forma do schema** (`scripts/generate-marketo-factories.py:105-173`):
  - um `$ref` chama a factory aninhada, `makeY()` (`:107-112`); um array de `$ref` vira `faker.helpers.multiple(() => makeY(), { count: { min: 1, max: 3 } })` (`:120-130`); um `allOf` com `$ref` vira `...makeBase()` (`:180-189`);
  - um `$ref` que volta ao próprio dono é omitido, e um array dele vira `[]` (`:109-110`, `:124-125`), para a recursão terminar;
  - um `enum` vira `faker.helpers.arrayElement([...] as const)` (`:114-116`);
  - um `integer` cujo nome termina em `id` vai de 1 a 99999, outro `integer` de 1 a 1000, e um `number`, ou um `format: float`, é um float de 0 a 1000 com 2 casas (`:152-158`);
  - uma string `date-time` vira `faker.date.recent().toISOString()` (`:161-162`). Depois vêm as heurísticas pela descrição, que recuperam um enum só documentado em texto (`:55-60`), e as heurísticas pelo nome, em ordem (`:38-53`): `workspace` é sempre `'Default'` (`:45`). O resto vira `faker.lorem.word()` (`:171`).
- **O envelope é fixo.** Uma propriedade `success`, `requestId`, `errors` ou `warnings` que não é `$ref` recebe `true`, `mockRequestId()`, `[]` e `[]` (`ENVELOPE_VALUES`, `scripts/generate-marketo-factories.py:30-36`, aplicado em `:191-196`). O `result` segue o schema. Exemplo: `src/asset/asset-mocks/factories/response-of-snippet-response.ts:6-19`.
- **O `requestId` tem o formato do Marketo.** `mockRequestId()` devolve 4 alfanuméricos, `#` e 11 alfanuméricos, como `e42b#14272d07d78` (`src/asset/asset-mocks/request-id.ts:3-8`).
- **O seed vem do ambiente.** `seedMockData()` lê `MARKETO_MOCK_SEED` e `MARKETO_MOCK_REF_DATE`, com a data padrão `2024-01-01T00:00:00.000Z` (`src/asset/asset-mocks/seed.ts:4`, `:11-14`):
  - sem seed, ela volta sem tocar no faker (`:15-17`), e as respostas são aleatórias;
  - com seed, chama `faker.seed(seed)` e `faker.setDefaultRefDate(refDate)` (`:19-22`);
  - o boot a chama uma vez, antes de criar a aplicação (`src/main.ts:8`). O README documenta as duas variáveis (`README.md:67-77`).
- **Tudo isso é código gerado.** `seed.ts`, `request-id.ts` e os dois `index.ts` também saem do gerador (`scripts/generate-marketo-factories.py:227-297`). A fronteira da [ADR 0004](0004-swagger-as-single-source-with-committed-generated-code.md) vale para eles.
- **faker é dependência de runtime.** `@faker-js/faker` `^10.6.0` está em `dependencies` (`package.json:35`) desde o `01ee283`. Os serviços chamam as factories a cada requisição, e esse foi o motivo da mudança (inferido; confirmar). O lockfile o trava em 10.6.0.

## Racional

- **Overrides tipados.** Quem chama fixa só os campos que importam e recebe o resto preenchido, e `Partial<X>` faz o compilador conferir esses campos (inferido; confirmar). Hoje nenhum código usa overrides: os 220 métodos de serviço chamam a factory sem argumento. Eles existem para testes e para o comportamento que vive ao lado do código gerado ([ADR 0009](0009-behaviour-beside-generated-code.md)) (inferido; confirmar).
- **Factories aninhadas para `$ref`.** Cada objeto aninhado sai da factory da própria definição, então fica válido pelo próprio DTO e tem um lugar só para mudar (inferido; confirmar).
- **O envelope fixo.** O gerador diz o motivo: um envelope "must look like a successful call, not random noise" (`scripts/generate-marketo-factories.py:30`).
- **As heurísticas.** O gerador também diz: dados "contextually believable" (`:38`), e o enum recuperado da descrição "so mocks stay valid" (`:55-56`).
- **A data de referência.** Sem ela, helpers relativos como `faker.date.recent()` ficam presos ao relógio e mudam entre execuções (`src/asset/asset-mocks/seed.ts:20-21`).
- **O seed por variável de ambiente.** Uma variável fixa os dados sem mudar código, e esse foi o motivo (inferido; confirmar). O README promete a mesma resposta entre reinícios (`README.md:69-70`).
- **Aleatório por padrão.** O histórico não diz por quê. Dados que variam expõem um cliente que depende de um valor que o contrato não garante (inferido; confirmar).

## Alternativas consideradas

O histórico não registra que alternativas foram avaliadas. Cada motivo abaixo é uma leitura do código.

| Opção | Por que não |
| --- | --- |
| Manter `NotImplementedException`, o estado do `0c8e760` | A rota existe, mas não responde o formato documentado, que é o valor do mock (inferido; confirmar) |
| Exemplos do próprio Swagger | Só 1 das 1.345 propriedades de topo tem `example`, e nenhuma resposta tem `examples`, então não cobririam as respostas (inferido; confirmar) |
| Fixtures JSON escritas à mão | São 255 definições para manter à mão, e nada as prende ao Swagger quando ele muda (inferido; confirmar) |
| Um seed fixo sempre ligado | Um cliente passaria a depender, sem saber, dos valores de um seed (inferido; confirmar) |
| Overrides profundos, com merge recursivo | O spread raso é uma linha por factory e não pede helper de merge (inferido; confirmar). O custo está nas Consequências |

## Consequências

- **Mais fácil**:
  - os 186 métodos de serviço que devolvem um `ResponseOf*` respondem o envelope completo, com `success: true`, `errors: []` e `warnings: []`. Dos outros 34, 33 devolvem tipos com `success` e `requestId`, mas sem `errors` nem `warnings`, como `DeleteResponse` (`src/asset/asset-definitions/responses/delete-response.ts:1-4`) e os `*NewResponse`, e recebem os mesmos `success: true` e `mockRequestId()`. Só o `ModelResponse` não tem campo nenhum: é `{}` (`src/asset/asset-definitions/responses/model-response.ts:1`) ([ADR 0005](0005-nestjs-express-one-module-per-tag.md));
  - um teste fixa um campo com um override, e o resto continua válido pelo DTO;
  - `MARKETO_MOCK_SEED` fixa os dados de uma execução, sem mudar código.
- **Mais difícil**:
  - **o seed fixa a sequência, não cada resposta.** O `faker` é uma instância só, semeada uma vez no boot, e cada valor gerado avança o estado. Rodando `seedMockData()` e `mockRequestId()` em processos novos, `MARKETO_MOCK_SEED=42` deu os mesmos dois valores em cada processo, e os dois diferentes entre si. Medido na #4, chamando os services direto: duas chamadas seguidas ao mesmo método devolvem payloads diferentes, a primeira se repete depois de semear de novo, e uma chamada a outro método antes dela muda o resultado. Então a mesma requisição só devolve o mesmo payload se as requisições antes dela, desde o boot, foram as mesmas;
  - **um seed 0 conta como ausente.** `Number(...) || undefined` transforma `0`, o vazio e um texto não numérico em `undefined` (`src/asset/asset-mocks/seed.ts:12`). Rodando, `MARKETO_MOCK_SEED=0` e `MARKETO_MOCK_SEED=abc` deram valores diferentes em cada processo. O comentário do código diz "any integer" (`:8`);
  - **`MARKETO_MOCK_REF_DATE` sozinha não faz nada.** Sem seed, `seedMockData()` volta antes de `setDefaultRefDate` (`:15-22`);
  - **os overrides são rasos.** `...overrides` troca a propriedade de topo inteira, e `Partial<X>` também é raso: em `makeSnippetResponse`, um override de `folder` troca a pasta gerada inteira e precisa trazer uma `SnippetFolder` completa, com `value`, `type` e `folderName` (`src/asset/asset-definitions/models/snippet-folder.ts:3-16`);
  - **o envelope nunca é de erro.** `success: false` com `errors` só sai com um override, e nenhum código faz isso hoje. As falhas roteirizadas são da Track A ([ADR 0009](0009-behaviour-beside-generated-code.md));
  - **nada testa o seed, e as factories só passam pelo smoke da #9.** Nenhum spec importa as factories nem o seed: o smoke e2e só confere o envelope de `GET /rest/asset/v1/folders.json` (`test/app.e2e-spec.ts:19-27`), e o critério do seed no [project intent](../intent/project-intent.md#critérios-de-aceite) segue sem teste;
  - **o lockfile ficou defasado até a #9.** No `610e101`, a raiz dele listava faker em `devDependencies` (`610e101:package-lock.json:20-21`) e marcava a entrada com `"dev": true` (`610e101:package-lock.json:218-222`). O `01ee283` acrescentou o `@nestjs/swagger` ao lockfile, mas não levou a mudança do faker. Com o npm 11.9.0, isso não tirava o faker de uma instalação de produção: o npm recalcula as marcas a partir do `package.json`, e `npm ci --omit=dev --dry-run` instalava `@faker-js/faker 10.6.0`, medido na leitura da #4. Outra versão do npm, ou uma ferramenta que confiasse na marca `dev` do lockfile, podia deixar de fora o faker de que o runtime precisa (inferido; confirmar). A #9 regenerou o lockfile: a raiz lista faker em `dependencies` (`package-lock.json:11-12`), e a entrada perdeu a marca `dev` (`package-lock.json:216-219`);
  - **mudar uma heurística ou o envelope é mudar o gerador.** Mas o gerador escreve em `src/asset-mocks` (`scripts/generate-marketo-factories.py:27`), não em `src/asset/asset-mocks`, e o `check:factories` acusa os 259 arquivos como ausentes (#7).

## Relacionados

- [ADR 0004: O Swagger como fonte única, com o código gerado commitado](0004-swagger-as-single-source-with-committed-generated-code.md), de onde vêm as definições
- [ADR 0005: NestJS sobre Express, com um módulo por tag](0005-nestjs-express-one-module-per-tag.md), cujos serviços chamam as factories
- [ADR 0006: DTOs como interfaces TypeScript](0006-dtos-as-typescript-interfaces.md), que tipam cada factory
- [ADR 0009: Comportamento ao lado do código gerado, nunca dentro](0009-behaviour-beside-generated-code.md), que usa os overrides
- [Pattern: Factory com overrides](../knowledge/patterns/factory-with-overrides.md)
- [Pattern: Gerar e conferir](../knowledge/patterns/generate-and-check.md)
- [Pattern: A fronteira do código gerado](../knowledge/patterns/generated-code-boundary.md)
- [Anti-pattern: Editar código gerado à mão](../knowledge/anti-patterns/hand-editing-generated-code.md), sobre o `5cc5e09`, que trocou os stubs pelas factories sem rodar o gerador
- [Feature: Registro retroativo do projeto](../intent/feature-retroactive-record.md)
- Os geradores no layout antigo (#7) e o lockfile regenerado (#9)

## Status

- **Criado**: 2026-09-25 (Fase: Build), registro retroativo de `0c8e760`..`fb4a804` (#4)
- **Status**: Accepted
- **Atualizado**: 2026-09-26 (Fase: Learn), a #9 regenerou o lockfile, que passou a listar o faker em `dependencies` sem a marca `dev`, e o smoke e2e da #9 passou a exercitar as factories de `folders.json`; as citações de `src/main.ts` e do `README.md` seguiram as linhas novas (#9)
