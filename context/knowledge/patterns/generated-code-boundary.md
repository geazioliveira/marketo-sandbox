# Pattern: A fronteira do código gerado

## Resumo

Três pastas de `src/asset/` são saída de gerador e nunca são editadas à mão; o comportamento vive ao lado delas e usa o que elas exportam.

## Problema

- O README diz para nunca editar essas pastas à mão (`README.md:60-61`), mas nada nos arquivos diz que eles são gerados: não há cabeçalho de "gerado, não edite". Pôr um é parte da correção planejada na #7.
- Antes do loop, a fronteira foi cruzada duas vezes:
  - o `e7a0bb6` moveu as 255 definições para `src/asset/asset-definitions/` sem mudar os geradores ([mover as pastas geradas sem o gerador](../anti-patterns/moving-generated-folders-without-the-generator.md));
  - o `5cc5e09` mudou os 69 arquivos de `src/asset/resources/` e reescreveu à mão o prefixo dos imports de 46 deles, que nenhuma versão do gerador emite ([editar código gerado à mão](../anti-patterns/hand-editing-generated-code.md)).

  Hoje os geradores e a saída commitada divergem, e o `npm run check:all` não passa (#7). Eles já divergiam no `0c8e760`, pelo sufixo `.js` dos imports ([gerar e conferir](generate-and-check.md)).
- Uma edição à mão não sobrevive. O gerador apaga a pasta de saída inteira antes de escrever (`scripts/marketo_codegen.py:94-95`), e o check acusa todo arquivo mudado e todo `*.ts` a mais (`scripts/marketo_codegen.py:117-127`).
- O mock ainda precisa de comportamento que o Swagger não descreve: estado, autenticação, falhas roteirizadas e validação estrita ([project intent](../../intent/project-intent.md)). Escrito dentro das pastas geradas, ele sumiria na próxima geração.

## Solução

### As pastas geradas

| Pasta | O que tem | Gerador |
| --- | --- | --- |
| `src/asset/asset-definitions/` | 255 interfaces: 92 em `models/`, 72 em `requests/` e 91 em `responses/` | `scripts/generate-marketo-definitions.py` |
| `src/asset/resources/` | 70 arquivos: um module, um controller e um service para cada uma das 23 tags, mais `asset-resources.module.ts` | `scripts/generate-marketo-resources.py` |
| `src/asset/asset-mocks/` | 259 arquivos: 255 factories e `factories/index.ts`, mais `request-id.ts`, `seed.ts` e `index.ts` | `scripts/generate-marketo-factories.py` |

- Os arquivos de cada pasta são os que o gerador lista em `generated_files` (`scripts/generate-marketo-definitions.py:161-166`, `scripts/generate-marketo-resources.py:265-282`, `scripts/generate-marketo-factories.py:279-297`).
- `seed.ts` e `request-id.ts` também são gerados (`scripts/generate-marketo-factories.py:227-271`). Mudar o seed é mudar o gerador.
- O resto de `src/` é escrito à mão: `src/main.ts`, `src/app.module.ts`, `src/app.controller.ts`, `src/app.controller.spec.ts`, `src/app.service.ts` e `src/asset/asset.module.ts`, que nenhum gerador emite.

### A regra

- **Nada nas três pastas muda à mão.** Nem um import, nem um arquivo novo, nem a formatação. Uma mudança ali sai do gerador ou do Swagger ([gerar e conferir](generate-and-check.md)).
- **Uma pasta gerada só muda de lugar junto com o gerador**, na mesma PR, com o `check:*` provando a saída.
- **Um arquivo gerado se reconhece pela pasta.** Enquanto a #7 não põe o cabeçalho, a tabela acima é a única marca.
- **A regra vale para toda pasta que um gerador escreve**, as que a reescrita multi-API trouxer inclusive (#6). A tabela muda na mesma PR que muda um gerador de lugar.
- **A revisão recusa** um diff numa das três pastas sem a mudança de gerador ou de Swagger que o explica e sem a saída do `check:*` na Verificação. Uma PR que toca uma delas é HIGH ([revisão classificada por risco](risk-classified-review.md)).

### O comportamento fica ao lado

- Estado, autenticação, falhas e validação vivem fora das três pastas ([ADR 0009](../../decisions/0009-behaviour-beside-generated-code.md), Proposed até a primeira sub-issue da Track A que construir comportamento).
- O comportamento chega ao código gerado só pelo que ele expõe, sem editá-lo:
  - os tipos dos DTOs, em `src/asset/asset-definitions/` ([ADR 0006](../../decisions/0006-dtos-as-typescript-interfaces.md));
  - as factories, que montam uma resposta com os campos que o comportamento decide ([factory com overrides](factory-with-overrides.md));
  - os services, que todo módulo exporta (`src/asset/resources/snippets/snippets.module.ts:8`), e as rotas que os controllers declaram ([a forma de um módulo de recurso](resource-module-shape.md));
  - os pontos transversais do Nest (guard, interceptor, middleware, pipe), registrados num módulo escrito à mão.
- **Um gancho que falta entra pelo gerador**, nunca na saída. O gerador emite o gancho, e o comportamento fica fora.
- O mecanismo, a pasta e o estado ficam para a primeira sub-issue da Track A que construir comportamento, como diz a ADR 0009.

## Quando usar

- Ao planejar qualquer mudança em `src/asset/`.
- Na revisão de toda PR: um arquivo mudado numa das três pastas liga esta regra.
- Ao construir o comportamento da Track A.

## Quando NÃO usar

- Numa PR que muda um gerador ou o Swagger: a saída muda, mas pelo gerador, e quem guia o trabalho é [gerar e conferir](generate-and-check.md).
- Nos arquivos escritos à mão listados acima.

## Decisões relacionadas

- [0004: O Swagger como fonte única, com o código gerado commitado](../../decisions/0004-swagger-as-single-source-with-committed-generated-code.md)
- [0006: DTOs como interfaces TypeScript](../../decisions/0006-dtos-as-typescript-interfaces.md)
- [0009: Comportamento ao lado do código gerado, nunca dentro](../../decisions/0009-behaviour-beside-generated-code.md)

## Status

- **Criado**: 2026-09-25 (Fase: Build), registro retroativo de `0c8e760`..`fb4a804` (#4)
- **Status**: Active
