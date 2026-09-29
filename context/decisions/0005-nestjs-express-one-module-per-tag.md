# ADR 0005: NestJS sobre Express, com um módulo por tag

## Contexto

- O mock precisa de uma rota HTTP para cada uma das 220 operações do Swagger de assets, que o documento agrupa em 23 tags ([ADR 0004](0004-swagger-as-single-source-with-committed-generated-code.md)).
- O projeto nasceu do starter TypeScript do Nest: `610e101:package.json:2-4` ainda dizia `nest-typescript-starter` e "Nest TypeScript starter repository". A #9 tirou essas sobras.
- **No histórico.**
  - `0c8e760` traz o NestJS e os 23 módulos de recurso gerados, 70 arquivos em `src/asset/resources/`. Os services respondiam `throw new NotImplementedException(...)` em toda operação (`0c8e760:src/asset/resources/snippets/snippets.service.ts`).
  - `a967f26` muda o gerador de resources: o service passa a devolver uma factory (`a967f26:scripts/generate-marketo-resources.py:189`), e cada módulo passa a exportar o service (`:236`).
  - `5cc5e09` leva essas mudanças aos 69 arquivos commitados sem o gerador, que importa um `marketo_codegen` que só chega em `0ef242d`. Nos 23 módulos, acrescenta o `exports`. Nos 23 services, troca o `NotImplementedException` pela factory, com imports `../../`, onde o gerador emite `../../../`. Nos 23 controllers, troca o prefixo dos imports de `../../../asset-definitions` para `../../asset-definitions`. A mensagem só fala dos exports ([Anti-pattern: Mensagem de commit que diz menos do que o commit faz](../knowledge/anti-patterns/commit-message-understating-its-content.md)).
  - `fb4a804` serve a UI do Swagger em `api` (`fb4a804:src/main.ts:13-19`) e semeia o faker antes de criar o app (`fb4a804:src/main.ts:7`).
- **A #6 levou a forma a cinco áreas.** O gerador passou a rodar por alvo, com um documento Swagger por área ([ADR 0004](0004-swagger-as-single-source-with-committed-generated-code.md)), e a declarar o status 2xx documentado.

## Decisão

- **NestJS 12 sobre Express.** `@nestjs/common`, `@nestjs/core` e `@nestjs/platform-express` estão em `^12.0.1` (`package.json:36-38`), travados em 12.0.1 no `package-lock.json`. O lock traz o Express 5.2.1 e o path-to-regexp 8.4.2.
- **Um módulo por tag do Swagger.** O gerador agrupa as operações pela primeira tag (`610e101:scripts/generate-marketo-resources.py:266-270`).
  - Cada tag vira uma pasta `src/asset/resources/<tag-em-kebab>/` com três arquivos: controller, service e módulo. São 23 × 3 arquivos, mais o `asset-resources.module.ts`: 70.
  - As classes levam o `PascalCase` da tag (`610e101:scripts/generate-marketo-resources.py:105`, `:178`, `:225`). Uma tag "(New)" vira uma pasta `-new`, como `emails-new` (`610e101:scripts/marketo_codegen.py:23-27`).
- **A árvore de módulos.** `AppModule` importa `AssetModule` (`src/app.module.ts:2,11`), que importa `AssetResourcesModule` (`src/asset/asset.module.ts:5`), que importa os 23 módulos em ordem alfabética (`src/asset/resources/asset-resources.module.ts:30-54`). Quem ordena é o gerador (`610e101:scripts/generate-marketo-resources.py:279-281`).
- **A forma de um recurso**, com os arquivos de `src/asset/resources/snippets/` como exemplo ([Pattern: A forma de um módulo de recurso](../knowledge/patterns/resource-module-shape.md)):
  - **O módulo** declara o controller e o service e exporta o service (`snippets.module.ts:8-13`).
  - **O controller** não tem prefixo: `@Controller()` (`snippets.controller.ts:24`). Cada rota carrega o caminho inteiro do Swagger, com `{id}` trocado por `:id` (`610e101:scripts/generate-marketo-resources.py:70-71`), como `@Get('rest/asset/v1/snippet/:id.json')` (`snippets.controller.ts:28`). O nome do método é o `operationId` (`610e101:scripts/generate-marketo-resources.py:114,145`). Os parâmetros usam `@Param`, `@Query`, `@Body` e, nos três controllers das tags "(New)", `@Headers('x-app-type')`, 33 vezes, sempre sem pipe (`snippets.controller.ts:30`, `610e101:scripts/generate-marketo-resources.py:33-39`).
  - **O handler só delega** ao service (`snippets.controller.ts:33`, `610e101:scripts/generate-marketo-resources.py:146`).
  - **O service** ignora os argumentos (`..._arguments: unknown[]`) e devolve uma factory, como `return makeResponseOfSnippetResponse()` (`snippets.service.ts:15-21`).
  - No total, 220 decorators de rota: 81 `@Get` e 139 `@Post`.
- **O envelope.** 186 dos 220 métodos de service devolvem um `ResponseOf<X>`, o envelope do Marketo.
  - A forma é `{errors, requestId, result, success, warnings}`, com todos os campos opcionais e `result` como array (`src/asset/asset-definitions/responses/response-of-snippet-response.ts:7-13`).
  - A factory o preenche como uma chamada que deu certo: `success: true`, `errors: []`, `warnings: []` e um `requestId` de mock (`610e101:scripts/generate-marketo-factories.py:30-36`, aplicado em `:192-193`).
  - Dos outros 34, 33 devolvem tipos com `success` e `requestId`, mas sem `errors` nem `warnings`, como `DeleteResponse` (`src/asset/asset-definitions/responses/delete-response.ts:4-7`) e os `*NewResponse`. Só `ModelResponse` é `{}` (`src/asset/asset-definitions/responses/model-response.ts:4`). A [ADR 0007](0007-faker-factories-with-overrides-and-seed.md) diz o que as factories põem em cada um.
- **A ordem das rotas é a do Swagger, com uma exceção (#8).** O gerador percorre os caminhos na ordem do documento e anexa cada operação à tag dela nessa ordem (`scripts/generate-marketo-resources.py:448-451`). Dentro de cada tag, uma rota que uma rota anterior do mesmo método capturaria sobe para logo antes da primeira rota que a captura (`order_routes()`, `:97-117`, chamada em `:456`). Uma rota captura outra quando o caminho da outra, com os parâmetros trocados por `{}`, casa com o padrão dela, em que cada `{param}` aceita um segmento, sem distinguir maiúsculas de minúsculas, como o Express (`:81-94`). Nenhum segmento literal tem chaves, então uma rota literal nunca captura uma rota com parâmetro. Se duas rotas se capturam uma à outra, nenhuma ordem serve as duas, e a geração falha com o par (`:110-116`). O controller e o service seguem a mesma ordem. Entre módulos, a ordem continua a alfabética.
- **Desde a #6, um módulo de recursos por área.** Cada área tem um `<Área>ResourcesModule` em `src/<área>/resources/`, importado por um `<Área>Module` escrito à mão, e o `AppModule` importa os cinco, com o `MultipartModule` escrito à mão da #24 (`src/app.module.ts:10-17`, [Pattern: A forma de um módulo de recurso](../knowledge/patterns/resource-module-shape.md)). São 49 tags e 388 operações. A forma de cada recurso é a mesma.
- **Desde a #6, o status 2xx documentado.** Quando o menor 2xx que o Swagger declara difere do padrão do Nest (201 num POST, 200 no resto), o método ganha `@HttpCode` (`scripts/generate-marketo-resources.py:134-142`). Os 139 POSTs de assets passaram de 201 para 200, como o Swagger declara, e os 7 de Data Ingestion respondem 202. Uma resposta sem schema, como esse 202, sai sem corpo: o método do service não devolve nada (`:379-381`).

## Racional

- **NestJS.** O projeto começou do starter do Nest (`0c8e760:package.json:2-4`). Decorators de rota e injeção de dependência dão um lugar por operação e um service trocável por módulo (inferido; confirmar).
- **Express.** É a plataforma com que o starter vem (inferido; confirmar).
- **Um módulo por tag.** É o agrupamento que o próprio Swagger dá, com as 23 tags declaradas e todas usadas, e deixa cada recurso do Marketo numa pasta (inferido; confirmar).
- **Caminho inteiro, sem prefixo.** A rota fica igual ao caminho do Swagger, com a sintaxe de parâmetro trocada: acha-se por busca, e o gerador não precisa decompor o caminho (inferido; confirmar).
- **O service exportado.** O `exports` deixa outro módulo injetar o service, o que abre lugar para comportamento ao lado do código gerado ([ADR 0009](0009-behaviour-beside-generated-code.md)) (inferido; confirmar).
- **Um envelope de sucesso fixo.** O comentário do gerador diz que o envelope do Marketo precisa parecer uma chamada que deu certo, não ruído aleatório (`610e101:scripts/generate-marketo-factories.py:30`).
- **O status documentado.** O status faz parte do formato documentado que o mock promete, e um cliente que confere o status veria 201 onde o Marketo documenta 200 (inferido; confirmar).

## Alternativas consideradas

O histórico não registra alternativas. As linhas abaixo são as óbvias, e cada motivo é inferido.

| Opção | Por que não |
| --- | --- |
| Fastify (`@nestjs/platform-fastify`) | O starter vem com Express, e nada no mock pede outro servidor HTTP (inferido; confirmar) |
| Express sem Nest | Sem módulos nem injeção de dependência, o comportamento de um recurso não teria onde se encaixar ao lado do código gerado (inferido; confirmar) |
| Um módulo só, com as 220 rotas | Um arquivo enorme e nenhuma fronteira por recurso (inferido; confirmar) |
| Um prefixo por controller, como `@Controller('rest/asset/v1')` | O gerador teria de partir cada caminho em prefixo e resto, e a rota deixaria de ser a cópia literal do Swagger (inferido; confirmar) |
| A ordem do Swagger sem exceção | 13 rotas nunca chegavam ao próprio handler (medido na #4, na #6 e na #8) |
| Toda rota literal antes das rotas com parâmetro, numa ordenação estável pelo número de parâmetros | Move 1.308 linhas em 52 arquivos gerados, contra 181 em 16 da regra escolhida, e afasta a ordem do Swagger sem ganho no roteamento (medido no plano da #8) |

As duas últimas linhas vêm do plano da #8 e foram medidas.

## Consequências

- **Mais fácil**:
  - cada operação do Swagger tem um método no controller e outro no service, que se acham pelo caminho ou pelo `operationId`;
  - todo método de service devolve, sem credenciais, um corpo com a forma da resposta de sucesso documentada (`610e101:scripts/generate-marketo-resources.py:88-101`);
  - toda requisição chega ao handler da rota que ela nomeia, e o `test/route-order.e2e-spec.ts` prova isso para as 388 rotas do app montado, na ordem real de registro (#8);
  - outro módulo pode injetar qualquer service, porque todo módulo o exporta.
- **Mais difícil**:
  - **Um controller não segue mais a ordem do Swagger à risca (#8).** Até a #8, a ordem era a do documento, e no Express a primeira rota declarada que casa vence. 13 rotas literais ficavam depois de uma rota com parâmetro do mesmo controller e nunca chegavam ao próprio handler: 11 de assets, medidas na #4, como `GET rest/asset/v1/smartCampaign/byName.json` (`610e101:src/asset/resources/smart-campaigns/smart-campaigns.controller.ts:43`) depois de `smartCampaign/:id.json` (`:21`), e 2 de `lead-database`, medidas na #6, `GET` e `POST rest/v1/customobjects/schema.json`. Com a regra, essas 13 sobem e movem 181 linhas em 16 arquivos gerados. Quem procura uma rota pela posição no Swagger a acha perto dela, não no mesmo lugar. O [Anti-pattern: Rota literal declarada depois de uma rota com parâmetro](../knowledge/anti-patterns/literal-route-after-param-route.md) guarda o defeito.
  - **Entre módulos, a ordem alfabética decide.** `GET form/fields.json` e `GET form/programMemberFields.json`, de `form-fields`, casam com `form/:id.json`, de `forms`, e chegam ao próprio handler só porque o `FormFieldsModule` vem antes do `FormsModule` (`src/asset/resources/asset-resources.module.ts:39-40`), na ordem que o gerador dá (`scripts/generate-marketo-resources.py:462-464`). A regra da #8 vale dentro de uma tag, e renomear uma tag pode inverter esse caso (inferido; confirmar). Se inverter, o `test/route-order.e2e-spec.ts` falha.
  - **Desde a #6, o consumidor vê outro status.** Um cliente que esperava o 201 de um POST de assets recebe 200.
  - **Desde a #8, o consumidor vê outra resposta nas 13 rotas.** Onde o tipo documentado da rota literal difere do da rota com parâmetro, como `smartCampaign/rules.json`, que respondia um `ResponseOfSmartCampaignResponseWithFlow` e agora responde o `ResponseOfSmartCampaignRuleType` documentado, a resposta muda de forma.
  - **Um corpo acima de 100 KiB responde 413**, em qualquer rota. É o limite padrão do body parser do Express, que o `src/main.ts` não muda. Isso já valia antes da #6, e com ela passa a pegar também os lotes de Lead Database e de Data Ingestion: 250 leads com 110,8 KiB em `POST /rest/v1/leads.json` dão 413 (medido na #6; #25).
  - Nenhum pipe converte ou valida um parâmetro, nem o `@Param('id') id: number` ([ADR 0006](0006-dtos-as-typescript-interfaces.md)).
  - O service ignora os argumentos: a resposta não depende do id nem do corpo, e não há estado. Estado, autenticação e falhas roteirizadas entram com a Track A, e a [ADR 0009](0009-behaviour-beside-generated-code.md), ainda `Proposed`, põe esse comportamento ao lado do código gerado.
  - A forma de controller, service e módulo vem do gerador. Mudá-la é mudar o gerador e regenerar ([ADR 0004](0004-swagger-as-single-source-with-committed-generated-code.md)).

## Relacionados

- [ADR 0004: O Swagger como fonte única, com o código gerado commitado](0004-swagger-as-single-source-with-committed-generated-code.md), de onde vêm as rotas
- [ADR 0006: DTOs como interfaces TypeScript](0006-dtos-as-typescript-interfaces.md), os tipos dos parâmetros e dos retornos
- [ADR 0007: Factories faker com overrides e seed](0007-faker-factories-with-overrides-and-seed.md), o que os services devolvem
- [ADR 0008: A toolchain](0008-toolchain.md)
- [ADR 0009: Comportamento ao lado do código gerado, nunca dentro](0009-behaviour-beside-generated-code.md)
- [Pattern: A forma de um módulo de recurso](../knowledge/patterns/resource-module-shape.md)
- [Anti-pattern: Rota literal declarada depois de uma rota com parâmetro](../knowledge/anti-patterns/literal-route-after-param-route.md)
- [Anti-pattern: Mensagem de commit que diz menos do que o commit faz](../knowledge/anti-patterns/commit-message-understating-its-content.md)
- A correção das rotas sombreadas (#8) e as sobras do starter (#9)

## Status

- **Criado**: 2026-09-25 (Fase: Build), registro retroativo de `0c8e760`..`fb4a804` (#4)
- **Status**: Accepted
- **Atualizado**: 2026-09-26 (Fase: Learn), a #9 renomeou o pacote e tirou do `AppModule` o Observe, o `AppController` e o `AppService`; as citações do `package.json` e do `src/app.module.ts` seguiram as linhas novas, e as que descrevem o starter passaram a apontar para o commit (#9)
- **Atualizado**: 2026-09-26 (Fase: Learn), um módulo de recursos por área e o `@HttpCode` do status 2xx documentado; as citações do gerador de antes da #6 passaram a levar o commit `610e101`, e as do controller de snippets, do `asset-resources.module.ts` e do `AppModule` seguiram as linhas novas (#6)
- **Atualizado**: 2026-09-26 (Fase: Learn), a ordem das rotas ganhou a exceção da #8: dentro de uma tag, uma rota sobe para logo antes da primeira que a capturaria, e a geração falha com duas rotas ambíguas; as consequências e as alternativas registram as 13 rotas sombreadas até então e a ordenação medida e descartada, e as citações do gerador seguiram as linhas novas (#8)
- **Atualizado**: 2026-09-26 (Fase: Build), as citações dos arquivos gerados e dos geradores seguiram as linhas novas, depois do cabeçalho de gerado (#7)
- **Atualizado**: 2026-09-28 (Fase: Build), as citações dos geradores, do `AppModule`, do `package.json` e do lockfile seguiram as linhas novas (#24)
