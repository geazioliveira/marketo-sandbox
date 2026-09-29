# ADR 0009: Comportamento ao lado do código gerado, nunca dentro

## Contexto

- **O que falta construir.** O [project intent](../intent/project-intent.md) quer um mock que, além das rotas, reproduza o comportamento que um cliente precisa provar. Um critério de aceite pede espaços isolados, autenticação, modelo com estado, log de requisições, falhas roteirizadas e validação estrita, como pede a Track A do lite-campaign (R1–R8). A decisão em aberto "[Onde vive o comportamento com estado](../intent/project-intent.md#decisões-em-aberto)" dizia "ao lado do código gerado, nunca dentro dele" e mandava registrar a decisão na #4. Agora ela aponta para esta ADR.
- **Hoje não há comportamento.**
  - Os 220 métodos de serviço ignoram os argumentos (`..._arguments: unknown[]`) e devolvem uma factory sem override (`src/asset/resources/snippets/snippets.service.ts:17-21`).
  - O controller passa os argumentos ao serviço (`src/asset/resources/snippets/snippets.controller.ts:33`), sem pipe: `@Param('id') id: number` não tem `ParseIntPipe` (`:30`).
  - Nenhuma biblioteca de validação é usada ([ADR 0006](0006-dtos-as-typescript-interfaces.md)).
- **Regenerar apaga a pasta de saída.** O `write_outputs()` roda `shutil.rmtree` em cada pasta de saída antes de escrever (`scripts/marketo_codegen.py:409-411`), e o `check_outputs()` acusa como inesperado todo `*.ts` da pasta de saída que o gerador não emitiu (`:428-432`). Um arquivo escrito à mão em `src/asset/resources/` some no próximo `npm run generate:resources` e reprova o `check:resources`.
- **O histórico já mostra o custo de misturar.** O `5cc5e09` mudou a saída gerada sem o gerador: nesse commit o gerador de resources nem rodava, porque o `marketo_codegen.py` que ele importa só chegou no `0ef242d`, e ele emitiu `../../../`, onde os arquivos commitados têm `../../`, até a #6 (`610e101:scripts/generate-marketo-resources.py:59`, `:63`). O `e7a0bb6` moveu as definições para `src/asset/` sem mudar o gerador, e o `b91681a` commitou as factories fora da pasta que o gerador delas escreve. Por isso o `npm run check:all` não passava antes da #6 (#7).
- **Os pontos de encaixe que já existem.**
  - `src/asset/asset.module.ts` fica fora de toda pasta que um gerador escreve e importa o `AssetResourcesModule` (`src/asset/asset.module.ts:1-7`). Ele veio no `0c8e760`, e nenhum gerador o emite.
  - Cada módulo gerado exporta o próprio serviço, como `exports: [SnippetsService]` (`src/asset/resources/snippets/snippets.module.ts:11`). O gerador faz isso desde o `a967f26` (`scripts/generate-marketo-resources.py:421`).
  - As factories aceitam overrides ([ADR 0007](0007-faker-factories-with-overrides-and-seed.md)).
- **O layout mudou na #6.** A reescrita multi-API trouxe as áreas `src/{data-ingestion,identity,lead-database,user-management}/` e o `src/mocks/` comum, cada área com as próprias pastas geradas ([ADR 0004](0004-swagger-as-single-source-with-committed-generated-code.md)). O R3 da Track A depende de `identity/oauth/token`, e o R4 do `userservice`, que desde a #6 têm rota.

## Decisão

- **O comportamento vive ao lado.** O comportamento com estado da Track A mora em módulos e providers próprios, em arquivos que nenhum gerador escreve: espaços isolados, autenticação, o modelo com estado, o log de requisições, as falhas roteirizadas e a validação estrita. Ele nunca entra em `src/asset/asset-definitions/`, `src/asset/resources/` ou `src/asset/asset-mocks/`, nem em outra pasta que um gerador escreva, as da #6 inclusive.
- **Ele envolve ou substitui o gerado, sem editá-lo.** O comportamento chega ao código gerado só pelo que o código gerado expõe:
  - os serviços exportados;
  - as factories com overrides;
  - as interfaces dos DTOs;
  - os pontos transversais do Nest (guard, interceptor, middleware, pipe), registrados num módulo escrito à mão.

  Uma resposta diferente sai de um override de factory ou de um provider que substitui o serviço gerado, nunca de uma edição no serviço gerado.
- **Um gancho que falta entra pelo gerador.** Quando o comportamento precisa de um ponto de encaixe que o código gerado não tem, o gancho entra em `scripts/*.py` e é regenerado. O gerador emite só o gancho, nunca o comportamento.
- **Regenerar nunca apaga comportamento.** Depois de `npm run generate:all`, o comportamento continua no lugar, e o `npm run check:all` não acha arquivo inesperado.
- **Quando esta decisão é aceita.** Ela fica `Proposed` até a primeira sub-issue da Track A que construir comportamento. A PR dessa sub-issue a aceita ou a substitui, e atualiza a linha dela no [índice de decisões](README.md). O plano dessa sub-issue decide:
  1. **O mecanismo.** Como o comportamento chega a uma rota: um guard, um interceptor ou um middleware global num módulo escrito à mão; um provider que substitui o serviço gerado; ou um gancho no gerador, como um serviço gerado que delega a um provider injetável. E se isso pede mudar o gerador antes.
  2. **O lugar.** A pasta do comportamento, fora de toda saída de gerador, no layout que a #6 deixar.
  3. **O estado.** Como o estado se separa por espaço isolado e como volta ao zero entre testes.
  4. **As factories e o seed.** Como o comportamento usa os overrides, e o que o seed da [ADR 0007](0007-faker-factories-with-overrides-and-seed.md) passa a garantir quando existe estado.
  5. **A prova.** O teste que mostra que `npm run generate:all` seguido de `npm run check:all` deixa o comportamento intacto.

## Racional

- **O gerador apaga o que não emitiu.** Com o `rmtree` e o `check_output`, uma pasta gerada só guarda o que o gerador escreveu. O único lugar onde código escrito à mão sobrevive a uma regeneração é fora dela.
- **O código gerado é função do Swagger** ([ADR 0004](0004-swagger-as-single-source-with-committed-generated-code.md)). O comportamento com estado não está no Swagger, e o project intent põe fora de escopo o comportamento que o Swagger não documenta, exceto quando registrado como inferência. Pôr o comportamento no gerador misturaria o que o Swagger diz com o que o mock decide (inferido; confirmar).
- **A revisão lê cada coisa no seu lugar.** Um diff numa pasta gerada é sempre saída do gerador, e o comportamento aparece nos próprios arquivos ([revisão classificada por risco](../knowledge/patterns/risk-classified-review.md)) (inferido; confirmar).
- **A #6 vai mover as pastas geradas.** Comportamento fora delas não se move junto (inferido; confirmar).
- **A correção fica aqui.** O project intent diz que, quando falta algo, a correção é feita no mock, nunca com um contorno no consumidor.

## Alternativas consideradas

| Opção | Por que não |
| --- | --- |
| Editar os serviços gerados à mão | O próximo `generate:resources` apaga a edição (`scripts/marketo_codegen.py:409-411`), e o `check:resources` acusa a diferença. É o que o `5cc5e09` fez ([anti-pattern](../knowledge/anti-patterns/hand-editing-generated-code.md)) |
| O gerador emitir o comportamento | O comportamento não está no Swagger, e cada mudança nele viraria uma regeneração de dezenas de arquivos gerados (inferido; confirmar) |
| Um processo à parte, um proxy na frente do mock | Seriam dois processos para o consumidor subir, e o project intent pede subir o mock com um comando documentado (inferido; confirmar) |
| O comportamento no consumidor | O project intent pede a correção aqui, nunca um contorno no consumidor. O simulador escrito à mão do lite-campaign foi a origem de brunohab/lite-campaign#47, #54, #60 e #61 |
| Parar de gerar e manter o código à mão | Perde o Swagger como fonte única ([ADR 0004](0004-swagger-as-single-source-with-committed-generated-code.md)) |

## Consequências

- **Mais fácil**:
  - regenerar a qualquer momento, sem perder comportamento;
  - o `check:all` continua querendo dizer "o gerado é exatamente o que o gerador emite";
  - o comportamento é revisado nos próprios arquivos, e o código gerado, no gerador.
- **Mais difícil**:
  - **o comportamento acompanha a superfície gerada.** Os nomes de método vêm do `operationId`, como `getSnippetByIdUsingGET` (`src/asset/resources/snippets/snippets.service.ts:17`), e uma mudança no Swagger pode quebrar o comportamento. O typecheck pega a quebra quando o comportamento usa os tipos gerados (inferido; confirmar);
  - **trocar o serviço gerado não é direto hoje.** Cada módulo gerado declara o próprio serviço como provider (`src/asset/resources/snippets/snippets.module.ts:8-13`), e o controller gerado o recebe no construtor (`src/asset/resources/snippets/snippets.controller.ts:26`). Trocá-lo sem tocar no módulo gerado provavelmente pede um gancho no gerador (inferido; confirmar);
  - **o comportamento depende da ordem das rotas.** Até a #8, 13 rotas literais caíam no handler de uma rota com parâmetro declarada antes delas, e um comportamento preso a uma delas não rodaria ([ADR 0005](0005-nestjs-express-one-module-per-tag.md), [anti-pattern](../knowledge/anti-patterns/literal-route-after-param-route.md)). Desde a #8, o gerador ordena as rotas e o `test/route-order.e2e-spec.ts` prova que cada requisição chega ao próprio handler. Uma rota escrita à mão ao lado do código gerado entra na mesma prova, porque o teste lê o app montado;
  - **a prova depende dos geradores.** O teste do item 5 pede `generate:all` e `check:all` funcionando, e eles funcionam desde a #6.

## Relacionados

- A decisão em aberto "[Onde vive o comportamento com estado](../intent/project-intent.md#decisões-em-aberto)" do project intent, que esta decisão responde
- [ADR 0004: O Swagger como fonte única, com o código gerado commitado](0004-swagger-as-single-source-with-committed-generated-code.md)
- [ADR 0005: NestJS sobre Express, com um módulo por tag](0005-nestjs-express-one-module-per-tag.md), que dá os módulos que o comportamento envolve
- [ADR 0006: DTOs como interfaces TypeScript](0006-dtos-as-typescript-interfaces.md), sem validação em runtime
- [ADR 0007: Factories faker com overrides e seed](0007-faker-factories-with-overrides-and-seed.md)
- [Pattern: A fronteira do código gerado](../knowledge/patterns/generated-code-boundary.md)
- [Pattern: A forma de um módulo de recurso](../knowledge/patterns/resource-module-shape.md)
- [Pattern: Factory com overrides](../knowledge/patterns/factory-with-overrides.md)
- [Anti-pattern: Editar código gerado à mão](../knowledge/anti-patterns/hand-editing-generated-code.md)
- [Anti-pattern: Mover as pastas geradas sem o gerador](../knowledge/anti-patterns/moving-generated-folders-without-the-generator.md)
- [Feature: Registro retroativo do projeto](../intent/feature-retroactive-record.md)
- A reescrita multi-API (#6), os geradores no layout antigo (#7) e as rotas sombreadas (#8)

## Status

- **Criado**: 2026-09-25 (Fase: Build), registro retroativo de `0c8e760`..`fb4a804` (#4)
- **Status**: Proposed
- **Atualizado**: 2026-09-26 (Fase: Learn), o layout das cinco áreas chegou com a #6, e o `generate:all` e o `check:all` passaram a funcionar para a prova; as citações seguiram as linhas novas, e a do prefixo de import antigo passou a levar o commit `610e101` (#6)
- **Atualizado**: 2026-09-26 (Fase: Learn), as rotas sombreadas deixaram de atrapalhar o comportamento: o gerador as ordena, e o `test/route-order.e2e-spec.ts` confere o app montado; a citação do gerador seguiu a linha nova (#8)
- **Atualizado**: 2026-09-26 (Fase: Build), as citações dos arquivos gerados e dos geradores seguiram as linhas novas, depois do cabeçalho de gerado (#7)
- **Atualizado**: 2026-09-28 (Fase: Build), as citações dos geradores, do `AppModule`, do `package.json` e do lockfile seguiram as linhas novas (#24)
- **Atualizado**: 2026-09-29 (Fase: Build), as citações do `write_outputs()` e do `check_outputs()` seguiram as linhas novas (#29)
