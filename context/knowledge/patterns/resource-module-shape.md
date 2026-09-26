# Pattern: A forma de um módulo de recurso

## Resumo

Cada tag de um Swagger vira, na área dele, uma pasta com um module, um controller e um service: o controller declara o caminho inteiro de cada operação, o status 2xx documentado e delega, e o service devolve a factory da resposta documentada.

## Problema

- O mock tem 388 operações em 49 tags, nas cinco áreas de `src/`, e os 49 recursos têm a mesma forma porque saem do mesmo gerador ([ADR 0005](../../decisions/0005-nestjs-express-one-module-per-tag.md)). Quem revisa, testa ou constrói comportamento precisa saber o que cada arquivo faz e o que ele não faz.
- A forma mudou antes do loop sem que o histórico dissesse:
  - no `0c8e760`, os 23 services lançavam `NotImplementedException` (`0c8e760:src/asset/resources/snippets/snippets.service.ts:1-8`);
  - o `a967f26` passou o gerador para services que devolvem factories e módulos que exportam o service (`a967f26:scripts/generate-marketo-resources.py:189,236`);
  - o `5cc5e09` levou essa forma à saída commitada sem rodar o gerador, que nem rodava nesse commit, e deixou nos imports o prefixo `../../`, que nenhuma versão do gerador emitia, numa mensagem que só fala dos exports ([mensagem de commit que diz menos do que o commit faz](../anti-patterns/commit-message-understating-its-content.md)).
- Até a #6, todo POST respondia 201, o padrão do Nest, e o Swagger de assets declara 200 em todos os 139.
- Até a #8, a ordem das rotas seguia a ordem dos caminhos no Swagger, e 13 rotas literais ficavam depois de uma rota com parâmetro do mesmo controller, sem nunca chegar ao próprio handler: 11 de assets e 2 de `lead-database`.

## Solução

### Os arquivos

- **Uma pasta por tag**, `src/<área>/resources/<slug>/`. A primeira tag da operação decide o módulo (`scripts/generate-marketo-resources.py:379-382`). O slug é a tag em kebab-case, sem os parênteses: `Emails (New)` vira `emails-new` (`scripts/marketo_codegen.py:159-163`).
- **Três arquivos por pasta**: `<slug>.module.ts`, `<slug>.controller.ts` e `<slug>.service.ts` (`scripts/generate-marketo-resources.py:386-392`).
- **Os nomes vêm da tag em PascalCase**: `SnippetsModule`, `SnippetsController` e `SnippetsService`, e a propriedade `snippetsService` no controller (`scripts/generate-marketo-resources.py:215-217,340-357`).
- **A ligação.** O `<Área>ResourcesModule` importa os módulos da área em ordem alfabética do slug (`scripts/generate-marketo-resources.py:359-377,393-395`). O `<Área>Module`, escrito à mão, importa o `<Área>ResourcesModule` (`src/asset/asset.module.ts:1-7`), e o `AppModule` importa os cinco `<Área>Module`, nesta ordem: assets, Data Ingestion, Identity, Lead Database e User Management (`src/app.module.ts:10-14`).

| Área | Tags | Operações | `@Get` | `@Post` | `@Delete` |
| --- | ---: | ---: | ---: | ---: | ---: |
| `src/asset/` | 23 | 220 | 81 | 139 | 0 |
| `src/data-ingestion/` | 5 | 7 | 0 | 7 | 0 |
| `src/identity/` | 1 | 2 | 1 | 1 | 0 |
| `src/lead-database/` | 19 | 147 | 81 | 65 | 1 |
| `src/user-management/` | 1 | 12 | 6 | 6 | 0 |

### O module

- `controllers` e `providers` com o controller e o service da tag, e `exports` com o service (`scripts/generate-marketo-resources.py:349-354`). Todo módulo exporta o service.

### O controller

- **Sem prefixo.** `@Controller()` não recebe caminho (`src/asset/resources/snippets/snippets.controller.ts:21`).
- **O caminho inteiro em cada rota**, sem a barra inicial, com `{param}` trocado por `:param` (`scripts/generate-marketo-resources.py:67-68`).
- **Um método por operação**, `async`, com o nome do `operationId` do Swagger, que devolve `Promise<T>` com o tipo das respostas 2xx (`scripts/generate-marketo-resources.py:163-191,251-266`).
- **O status 2xx documentado.** Quando o menor 2xx declarado difere do padrão do Nest (201 num POST, 200 no resto), o método ganha `@HttpCode(<status>)` (`scripts/generate-marketo-resources.py:124-132,254-258`). Hoje isso dá `@HttpCode(200)` nos 139 POSTs de assets, nos 65 de `lead-database`, nos 6 de `user-management` e no de Identity, e `@HttpCode(202)` nos 7 de Data Ingestion.
- **Os parâmetros vêm do `in` do Swagger** (`scripts/generate-marketo-resources.py:36-42,117-121`):
  - `path` vira `@Param('<nome>')`;
  - `query` vira `@Query('<nome>')`;
  - `body`, e o `requestBody` do OpenAPI 3, viram `@Body()` (`scripts/marketo_codegen.py:128-141`), e `formData` vira `@Body('<nome>')`;
  - `header` vira `@Headers('<nome>')`.

  Os obrigatórios vêm antes dos opcionais (`scripts/generate-marketo-resources.py:232-237`).
- **Sem pipe nem validação.** `@Param('id') id: number` não passa por `ParseIntPipe` (`src/asset/resources/snippets/snippets.controller.ts:27`), e nada valida o corpo ([ADR 0006](../../decisions/0006-dtos-as-typescript-interfaces.md)). O tipo só vale para o TypeScript.
- **O método só delega** ao service, com o mesmo nome e os mesmos argumentos (`scripts/generate-marketo-resources.py:261-262`).
- **A ordem das rotas é a ordem dos caminhos no Swagger, com uma exceção** (`scripts/generate-marketo-resources.py:381-382`). Uma rota que uma rota anterior do mesmo método capturaria sobe para logo antes da primeira rota que a captura, e a geração falha quando duas rotas se capturam uma à outra (`order_routes()`, `:87-107`, chamada em `:387`). Sem isso, a rota literal nunca é alcançada ([rota literal declarada depois de uma rota com parâmetro](../anti-patterns/literal-route-after-param-route.md)). O service segue a mesma ordem, e o `test/route-order.e2e-spec.ts` confere o app montado (#8).

### O service

- **`@Injectable()`, um método por operação**, com o nome do método do controller e a assinatura `(..._arguments: unknown[])`. Os argumentos são ignorados (`scripts/generate-marketo-resources.py:291-338`).
- **O corpo sai da primeira resposta 2xx** (`scripts/generate-marketo-resources.py:163-191,306-314`):
  - com `$ref`, devolve a factory da definição;
  - com um array de `$ref`, devolve de 1 a 3 itens da factory;
  - sem schema nenhum, como o 202 do Data Ingestion, o método não devolve nada, e a rota responde sem corpo;
  - com outro schema, devolve `undefined as never`, e a rota também responde sem corpo. Só `inviteUserUsingPOST`, de `user-management`, cai aqui: o Swagger dele declara uma string (#24).
- **Os headers de resposta não são gerados.** Os 202 do Data Ingestion documentam um `X-Request-Id`, e a rota não o envia (#24).
- **O envelope é o caso comum.** Em assets, 186 dos 220 métodos devolvem uma factory `makeResponseOf*` com o envelope `{errors, requestId, result, success, warnings}`, e em `lead-database`, 135 dos 147, com `moreResult` e `nextPageToken` em alguns. Identity devolve o token (`ResponseOfIdentity`), e `user-management` devolve os tipos do documento dele, sem envelope.

### Os imports

- Os tipos entram com `import type` de `…/<área>-definitions/…`, e as factories, de `…/<área>-mocks/factories/…` (`src/asset/resources/snippets/snippets.service.ts:1-10`).
- O caminho sai de `relative_import()`, a partir de um arquivo em `resources/<slug>/` (`scripts/generate-marketo-resources.py:197-212`, `scripts/marketo_codegen.py:153-156`). O gerador e a saída commitada batem: o `check:resources` passa desde a #6.

### Exemplo

O recurso `Snippets`, cortado em duas operações:

```ts
// src/asset/resources/snippets/snippets.module.ts:5-10
@Module({
  controllers: [SnippetsController],
  providers: [SnippetsService],
  exports: [SnippetsService],
})
export class SnippetsModule {}

// src/asset/resources/snippets/snippets.controller.ts:21-40
@Controller()
export class SnippetsController {
  constructor(private readonly snippetsService: SnippetsService) {}

  @Get('rest/asset/v1/snippet/:id.json')
  async getSnippetByIdUsingGET(
    @Param('id') id: number,
    @Query('status') status?: 'approved' | 'draft',
  ): Promise<ResponseOfSnippetResponse> {
    return this.snippetsService.getSnippetByIdUsingGET(id, status)
  }

  @Post('rest/asset/v1/snippet/:id.json')
  @HttpCode(200)
  async updateSnippetUsingPOST(
    @Param('id') id: number,
    @Body() updateSnippetRequest: UpdateSnippetRequest,
  ): Promise<ResponseOfSnippetResponse> {
    return this.snippetsService.updateSnippetUsingPOST(id, updateSnippetRequest)
  }
  // …
}

// src/asset/resources/snippets/snippets.service.ts:12-24
@Injectable()
export class SnippetsService {
  async getSnippetByIdUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfSnippetResponse> {
    return makeResponseOfSnippetResponse()
  }
  // …
}
```

## Quando usar

- Ao ler, revisar ou testar uma rota do mock.
- Ao mudar o gerador de resources: esta é a forma que ele emite, e mudá-la é mudar este pattern na mesma PR.
- Ao planejar comportamento: ele se apoia nos services exportados e nas rotas desta forma, sem editá-los.

## Quando NÃO usar

- Para escrever comportamento dentro do service ou do controller gerados. Ele fica ao lado ([a fronteira do código gerado](generated-code-boundary.md)).
- Nos módulos escritos à mão, o `AppModule` e os cinco `<Área>Module`, que não saem do gerador.
- Como prova de que uma requisição chega ao próprio handler: a forma da resposta não diz isso. Quem prova é o `test/route-order.e2e-spec.ts` (#8).

## Decisões relacionadas

- [0005: NestJS sobre Express, com um módulo por tag](../../decisions/0005-nestjs-express-one-module-per-tag.md)
- [0004: O Swagger como fonte única, com o código gerado commitado](../../decisions/0004-swagger-as-single-source-with-committed-generated-code.md)
- [0006: DTOs como interfaces TypeScript](../../decisions/0006-dtos-as-typescript-interfaces.md)
- [0007: Factories faker com overrides e seed](../../decisions/0007-faker-factories-with-overrides-and-seed.md)
- [0009: Comportamento ao lado do código gerado, nunca dentro](../../decisions/0009-behaviour-beside-generated-code.md)

## Status

- **Criado**: 2026-09-25 (Fase: Build), registro retroativo de `0c8e760`..`fb4a804` (#4)
- **Status**: Active
- **Atualizado**: 2026-09-26 (Fase: Learn), a ordem das rotas ganhou a exceção que põe uma rota antes da primeira que a capturaria, com o teste do app montado, e as citações do gerador seguiram as linhas novas (#8)
