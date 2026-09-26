# ADR 0005: NestJS sobre Express, com um módulo por tag

## Contexto

- O mock precisa de uma rota HTTP para cada uma das 220 operações do Swagger de assets, que o documento agrupa em 23 tags ([ADR 0004](0004-swagger-as-single-source-with-committed-generated-code.md)).
- O projeto nasceu do starter TypeScript do Nest: `610e101:package.json:2-4` ainda dizia `nest-typescript-starter` e "Nest TypeScript starter repository". A #9 tirou essas sobras.
- **No histórico.**
  - `0c8e760` traz o NestJS e os 23 módulos de recurso gerados, 70 arquivos em `src/asset/resources/`. Os services respondiam `throw new NotImplementedException(...)` em toda operação (`0c8e760:src/asset/resources/snippets/snippets.service.ts`).
  - `a967f26` muda o gerador de resources: o service passa a devolver uma factory (`a967f26:scripts/generate-marketo-resources.py:189`), e cada módulo passa a exportar o service (`:236`).
  - `5cc5e09` leva essas mudanças aos 69 arquivos commitados sem o gerador, que importa um `marketo_codegen` que só chega em `0ef242d`. Nos 23 módulos, acrescenta o `exports`. Nos 23 services, troca o `NotImplementedException` pela factory, com imports `../../`, onde o gerador emite `../../../`. Nos 23 controllers, troca o prefixo dos imports de `../../../asset-definitions` para `../../asset-definitions`. A mensagem só fala dos exports ([Anti-pattern: Mensagem de commit que diz menos do que o commit faz](../knowledge/anti-patterns/commit-message-understating-its-content.md)).
  - `fb4a804` serve a UI do Swagger em `api` (`fb4a804:src/main.ts:13-19`) e semeia o faker antes de criar o app (`fb4a804:src/main.ts:7`).

## Decisão

- **NestJS 12 sobre Express.** `@nestjs/common`, `@nestjs/core` e `@nestjs/platform-express` estão em `^12.0.1` (`package.json:36-38`), travados em 12.0.1 no `package-lock.json`. O lock traz o Express 5.2.1 e o path-to-regexp 8.4.2.
- **Um módulo por tag do Swagger.** O gerador agrupa as operações pela primeira tag (`scripts/generate-marketo-resources.py:266-270`).
  - Cada tag vira uma pasta `src/asset/resources/<tag-em-kebab>/` com três arquivos: controller, service e módulo. São 23 × 3 arquivos, mais o `asset-resources.module.ts`: 70.
  - As classes levam o `PascalCase` da tag (`scripts/generate-marketo-resources.py:105`, `:178`, `:225`). Uma tag "(New)" vira uma pasta `-new`, como `emails-new` (`scripts/marketo_codegen.py:23-27`).
- **A árvore de módulos.** `AppModule` importa `AssetModule` (`src/app.module.ts:2,5`), que importa `AssetResourcesModule` (`src/asset/asset.module.ts:5`), que importa os 23 módulos em ordem alfabética (`src/asset/resources/asset-resources.module.ts:26-51`). Quem ordena é o gerador (`scripts/generate-marketo-resources.py:279-281`).
- **A forma de um recurso**, com os arquivos de `src/asset/resources/snippets/` como exemplo ([Pattern: A forma de um módulo de recurso](../knowledge/patterns/resource-module-shape.md)):
  - **O módulo** declara o controller e o service e exporta o service (`snippets.module.ts:5-10`).
  - **O controller** não tem prefixo: `@Controller()` (`snippets.controller.ts:13`). Cada rota carrega o caminho inteiro do Swagger, com `{id}` trocado por `:id` (`scripts/generate-marketo-resources.py:70-71`), como `@Get('rest/asset/v1/snippet/:id.json')` (`snippets.controller.ts:17`). O nome do método é o `operationId` (`scripts/generate-marketo-resources.py:114,145`). Os parâmetros usam `@Param`, `@Query`, `@Body` e, nos três controllers das tags "(New)", `@Headers('x-app-type')`, 33 vezes, sempre sem pipe (`snippets.controller.ts:19`, `scripts/generate-marketo-resources.py:33-39`).
  - **O handler só delega** ao service (`snippets.controller.ts:22`, `scripts/generate-marketo-resources.py:146`).
  - **O service** ignora os argumentos (`..._arguments: unknown[]`) e devolve uma factory, como `return makeResponseOfSnippetResponse()` (`snippets.service.ts:12-18`).
  - No total, 220 decorators de rota: 81 `@Get` e 139 `@Post`.
- **O envelope.** 186 dos 220 métodos de service devolvem um `ResponseOf<X>`, o envelope do Marketo.
  - A forma é `{errors, requestId, result, success, warnings}`, com todos os campos opcionais e `result` como array (`src/asset/asset-definitions/responses/response-of-snippet-response.ts:4-10`).
  - A factory o preenche como uma chamada que deu certo: `success: true`, `errors: []`, `warnings: []` e um `requestId` de mock (`scripts/generate-marketo-factories.py:30-36`, aplicado em `:192-193`).
  - Dos outros 34, 33 devolvem tipos com `success` e `requestId`, mas sem `errors` nem `warnings`, como `DeleteResponse` (`src/asset/asset-definitions/responses/delete-response.ts:1-4`) e os `*NewResponse`. Só `ModelResponse` é `{}` (`src/asset/asset-definitions/responses/model-response.ts:1`). A [ADR 0007](0007-faker-factories-with-overrides-and-seed.md) diz o que as factories põem em cada um.
- **A ordem das rotas é a do Swagger.** O gerador percorre `document["paths"]` na ordem do documento e anexa cada operação à tag dela nessa ordem (`scripts/generate-marketo-resources.py:267-270`). Nada põe uma rota literal antes de uma rota com parâmetro.

## Racional

- **NestJS.** O projeto começou do starter do Nest (`0c8e760:package.json:2-4`). Decorators de rota e injeção de dependência dão um lugar por operação e um service trocável por módulo (inferido; confirmar).
- **Express.** É a plataforma com que o starter vem (inferido; confirmar).
- **Um módulo por tag.** É o agrupamento que o próprio Swagger dá, com as 23 tags declaradas e todas usadas, e deixa cada recurso do Marketo numa pasta (inferido; confirmar).
- **Caminho inteiro, sem prefixo.** A rota fica igual ao caminho do Swagger, com a sintaxe de parâmetro trocada: acha-se por busca, e o gerador não precisa decompor o caminho (inferido; confirmar).
- **O service exportado.** O `exports` deixa outro módulo injetar o service, o que abre lugar para comportamento ao lado do código gerado ([ADR 0009](0009-behaviour-beside-generated-code.md)) (inferido; confirmar).
- **Um envelope de sucesso fixo.** O comentário do gerador diz que o envelope do Marketo precisa parecer uma chamada que deu certo, não ruído aleatório (`scripts/generate-marketo-factories.py:30`).

## Alternativas consideradas

O histórico não registra alternativas. As linhas abaixo são as óbvias, e cada motivo é inferido.

| Opção | Por que não |
| --- | --- |
| Fastify (`@nestjs/platform-fastify`) | O starter vem com Express, e nada no mock pede outro servidor HTTP (inferido; confirmar) |
| Express sem Nest | Sem módulos nem injeção de dependência, o comportamento de um recurso não teria onde se encaixar ao lado do código gerado (inferido; confirmar) |
| Um módulo só, com as 220 rotas | Um arquivo enorme e nenhuma fronteira por recurso (inferido; confirmar) |
| Um prefixo por controller, como `@Controller('rest/asset/v1')` | O gerador teria de partir cada caminho em prefixo e resto, e a rota deixaria de ser a cópia literal do Swagger (inferido; confirmar) |

## Consequências

- **Mais fácil**:
  - cada operação do Swagger tem um método no controller e outro no service, que se acham pelo caminho ou pelo `operationId`;
  - todo método de service devolve, sem credenciais, um corpo com a forma da resposta de sucesso documentada (`scripts/generate-marketo-resources.py:88-101`); as 11 rotas sombreadas abaixo são a exceção;
  - outro módulo pode injetar qualquer service, porque todo módulo o exporta.
- **Mais difícil**:
  - **Rota literal depois de rota com parâmetro (#8).** No Express, a primeira rota declarada que casa vence. Como a ordem é a do Swagger, 11 rotas literais ficam, no mesmo controller, depois de uma rota com `:id` que casa com elas. Dois exemplos:
    - `GET rest/asset/v1/smartCampaign/byName.json` (`src/asset/resources/smart-campaigns/smart-campaigns.controller.ts:43`) vem depois de `smartCampaign/:id.json` (`:21`);
    - `POST rest/asset/v2/email/bulk/delete` (`src/asset/resources/emails-new/emails-new.controller.ts:185`) vem depois de `email/:id/delete` (`:144`).

    A varredura estática, com o `match()` do path-to-regexp 8.4.2, acha as 11. Medido na #4 numa cópia de `origin/main` compilada com `tsc`: com o `AssetResourcesModule` servido em loopback e cada método de service trocado por um que devolve o próprio nome, as 11 chamadas chegam ao handler da rota com `:id`. De controle, `GET smartCampaign/12.json` e `GET smartCampaigns.json` chegam ao próprio handler. A #8 fica com o teste e2e e a correção, e o [Anti-pattern: Rota literal declarada depois de uma rota com parâmetro](../knowledge/anti-patterns/literal-route-after-param-route.md) com a regra.
  - **Entre módulos, a ordem alfabética decide.** `GET form/fields.json` e `GET form/programMemberFields.json`, de `form-fields`, casam com `form/:id.json`, de `forms`. Na mesma medição, as duas chegam ao próprio handler, porque o `FormFieldsModule` vem antes do `FormsModule` (`src/asset/resources/asset-resources.module.ts:36-37`), na ordem que o gerador dá (`scripts/generate-marketo-resources.py:279-281`). Renomear uma tag pode inverter isso (inferido; confirmar). A #8 não lista esse caso.
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
- As rotas sombreadas (#8) e as sobras do starter (#9)

## Status

- **Criado**: 2026-09-25 (Fase: Build), registro retroativo de `0c8e760`..`fb4a804` (#4)
- **Status**: Accepted
- **Atualizado**: 2026-09-26 (Fase: Learn), a #9 renomeou o pacote e tirou do `AppModule` o Observe, o `AppController` e o `AppService`; as citações do `package.json` e do `src/app.module.ts` seguiram as linhas novas, e as que descrevem o starter passaram a apontar para o commit (#9)
