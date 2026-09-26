# Pattern: Factory com overrides

## Resumo

Toda definição de um Swagger tem uma factory `makeX(overrides)` que devolve um objeto completo com dados do faker e aplica os overrides por cima, e o seed torna os dados reproduzíveis.

## Problema

- No `0c8e760`, os 23 services lançavam `NotImplementedException`: nenhuma rota devolvia dado (`0c8e760:src/asset/resources/snippets/snippets.service.ts:1-8`).
- Um simulador escrito à mão dentro de cada cliente se afasta da API. O do lite-campaign foi a origem de brunohab/lite-campaign#47, #54, #60 e #61 ([project intent](../../intent/project-intent.md)).
- Um teste ou um comportamento precisa de uma resposta inteira e plausível, mas só se importa com alguns campos. Escrever o resto à mão em cada lugar repete o Swagger.
- Sem seed, as respostas são aleatórias (`README.md:107`), e um consumidor não consegue comparar payloads.

## Solução

### A forma

- **Uma factory por definição**, 459 no total, em `src/<área>/<área>-mocks/factories/<definição-em-kebab>.ts`, com o nome `make<Definição>` (`scripts/generate-marketo-factories.py:64-65,295-304`).
- **A assinatura e o corpo** (`scripts/generate-marketo-factories.py:222-230`):

  ```ts
  // src/asset/asset-mocks/factories/snippet-response.ts:5-20
  export function makeSnippetResponse(
    overrides: Partial<SnippetResponse> = {},
  ): SnippetResponse {
    return {
      createdAt: faker.date.recent().toISOString(),
      description: faker.lorem.sentence(),
      folder: makeSnippetFolder(),
      id: faker.number.int({ min: 1, max: 99999 }),
      // …
      workspace: 'Default',
      ...overrides,
    }
  }
  ```

- **Todo campo é preenchido**, obrigatório ou não (`scripts/generate-marketo-factories.py:198-206`). Só fica de fora um `$ref` que voltaria à própria definição (abaixo).
- **Um schema sem `properties` não tem campo a preencher.** `Person` e `CustomObject`, do Data Ingestion, só têm `additionalProperties`, e a factory devolve só os overrides (`src/data-ingestion/data-ingestion-mocks/factories/person.ts`).

### Como os campos são preenchidos

- **`$ref`** chama a factory aninhada: `folder: makeSnippetFolder()` (`scripts/generate-marketo-factories.py:114-119`).
- **Array de `$ref`** gera de 1 a 3 itens com a factory aninhada (`scripts/generate-marketo-factories.py:127-137`).
- **Um `$ref` que leva de volta à própria definição** fica de fora, ou vira `[]` num array, para a recursão terminar (`scripts/generate-marketo-factories.py:98-110,116-117,131-132`).
- **`allOf`** espalha a factory da base antes dos campos próprios (`scripts/generate-marketo-factories.py:187-196`).
- **`enum`** sorteia um dos valores com `faker.helpers.arrayElement` (`scripts/generate-marketo-factories.py:121-123`).
- **Strings**: `date-time` vira uma data ISO recente; depois vêm as heurísticas pela descrição (com `draft or approved`, sorteia `'approved'` ou `'draft'`) e pelo nome (`workspace` é sempre `'Default'`, `email`, `url`, `name`…) (`scripts/generate-marketo-factories.py:39-61,167-178`).
- **Inteiros**: um `id`, ou um nome que termina em `id`, vai de 1 a 99999 (`scripts/generate-marketo-factories.py:163-164`).

### O envelope

- Os campos do envelope têm valor fixo em toda factory que os tem: `success: true`, `requestId: mockRequestId()`, `errors: []` e `warnings: []` (`ENVELOPE_VALUES`, `scripts/generate-marketo-factories.py:31-37,198-203`). Por padrão, todo envelope é uma chamada bem-sucedida.
- `result` vem da factory aninhada, com 1 a 3 itens (`src/asset/asset-mocks/factories/response-of-snippet-response.ts:9-17`).
- `mockRequestId()` segue o formato do Marketo, `e42b#14272d07d78` (`src/mocks/request-id.ts:3-8`).

### O seed

- `seedMockData()` roda no começo do `bootstrap`, antes de o app ser criado (`src/main.ts:4,7`).
- Com `MARKETO_MOCK_SEED`, ele chama `faker.seed` e fixa a data de referência dos helpers relativos, `MARKETO_MOCK_REF_DATE` ou `2024-01-01T00:00:00.000Z` (`src/mocks/seed.ts:4,11-23`, `README.md:105-115`).
- Sem a variável, ele volta sem tocar no faker, e as respostas são aleatórias (`src/mocks/seed.ts:15-17`). Um seed `0` conta como ausente: `Number('0') || undefined` é `undefined` (`src/mocks/seed.ts:12`).
- O seed vale para a instância compartilhada do faker (`src/mocks/seed.ts:19`), e desde a #6 ela é uma só para as cinco áreas: `src/mocks/` é comum a todas (`scripts/generate-marketo-factories.py:286-292`). Então a mesma requisição só devolve o mesmo payload quando chega na mesma posição da sequência de chamadas desde o início do processo, contando as chamadas a qualquer área, como a #4 mediu ([ADR 0007](../../decisions/0007-faker-factories-with-overrides-and-seed.md)). Nenhum teste prova a reprodutibilidade ainda ([project intent](../../intent/project-intent.md)).
- `seed.ts` também é gerado (`scripts/generate-marketo-factories.py:250-278`). Mudar o seed é mudar o gerador.

### Como sobrescrever

- **`overrides` é `Partial<X>` e entra por último** (`scripts/generate-marketo-factories.py:223,228`). Um campo em `overrides` substitui o campo gerado inteiro.
- **O merge é raso.** Para mudar um campo aninhado, passe o objeto aninhado montado pela factory dele, com os próprios overrides:

  ```ts
  makeResponseOfSnippetResponse({
    result: [makeSnippetResponse({ id: 42, status: 'draft' })],
  })
  ```

- **Uma falha também é um override** do envelope:

  ```ts
  makeResponseOfSnippetResponse({ success: false, errors: [makeError()], result: [] })
  ```

- **Um override com valor fixo não muda o que o faker sorteia** dentro da factory: todos os campos são sorteados antes do spread (`scripts/generate-marketo-factories.py:225-228`). Um override montado com outra factory sorteia antes da chamada e desloca a sequência do seed.
- **Quem sobrescreve:**
  - **um teste** passa em `overrides` os campos que ele afirma e deixa o resto sorteado. Para comparar um payload inteiro, fixa o seed antes com `seedMockData(<n>)` (`src/mocks/seed.ts:11-14`);
  - **o comportamento** da Track A pode montar a resposta com a factory e passar como override o que o estado dele decide, fora do código gerado. A [ADR 0009](../../decisions/0009-behaviour-beside-generated-code.md), Proposed, deixa o mecanismo para a primeira sub-issue da Track A que construir comportamento.
- Hoje ninguém passa overrides: todo service gerado chama a factory sem argumento (`src/asset/resources/snippets/snippets.service.ts:17`), e nenhum teste usa as factories.

## Quando usar

- Para montar qualquer resposta ou payload de uma das cinco áreas num teste ou num comportamento.
- Para simular uma falha ou um estado específico: overrides no envelope e em `result`.

## Quando NÃO usar

- Para mudar o padrão de todas as respostas, como um campo sempre errado. Isso é uma mudança no gerador ([gerar e conferir](generate-and-check.md)), nunca uma edição no arquivo da factory ([a fronteira do código gerado](generated-code-boundary.md)).
- Como evidência do comportamento real do Marketo. Os dados são plausíveis, não reais, e heurísticas como `workspace: 'Default'` são escolha do gerador (`scripts/generate-marketo-factories.py:46`). O [project intent](../../intent/project-intent.md) deixa isso fora de escopo.

## Decisões relacionadas

- [0007: Factories faker com overrides e seed](../../decisions/0007-faker-factories-with-overrides-and-seed.md)
- [0004: O Swagger como fonte única, com o código gerado commitado](../../decisions/0004-swagger-as-single-source-with-committed-generated-code.md)
- [0006: DTOs como interfaces TypeScript](../../decisions/0006-dtos-as-typescript-interfaces.md)
- [0009: Comportamento ao lado do código gerado, nunca dentro](../../decisions/0009-behaviour-beside-generated-code.md)

## Status

- **Criado**: 2026-09-25 (Fase: Build), registro retroativo de `0c8e760`..`fb4a804` (#4)
- **Status**: Active
- **Atualizado**: 2026-09-26 (Fase: Learn), as factories passaram a existir nas cinco áreas, e o seed e o `mockRequestId()` foram para `src/mocks/`, comuns a todas (#6)
