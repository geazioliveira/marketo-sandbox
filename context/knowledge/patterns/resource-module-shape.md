# Pattern: A forma de um módulo de recurso

## Resumo

Cada tag do Swagger vira uma pasta com um module, um controller e um service: o controller declara o caminho inteiro de cada operação e delega, e o service devolve a factory da resposta documentada.

## Problema

- O mock tem 220 operações em 23 tags, e os 23 recursos têm a mesma forma porque saem do mesmo gerador ([ADR 0005](../../decisions/0005-nestjs-express-one-module-per-tag.md)). Quem revisa, testa ou constrói comportamento precisa saber o que cada arquivo faz e o que ele não faz.
- A forma mudou antes do loop sem que o histórico dissesse:
  - no `0c8e760`, os 23 services lançavam `NotImplementedException` (`0c8e760:src/asset/resources/snippets/snippets.service.ts:1-8`);
  - o `a967f26` passou o gerador para services que devolvem factories e módulos que exportam o service (`a967f26:scripts/generate-marketo-resources.py:189,236`);
  - o `5cc5e09` levou essa forma à saída commitada sem rodar o gerador, que nem rodava nesse commit, e deixou nos imports o prefixo `../../`, que nenhuma versão do gerador emite, numa mensagem que só fala dos exports ([mensagem de commit que diz menos do que o commit faz](../anti-patterns/commit-message-understating-its-content.md)).
- A ordem das rotas segue a ordem dos caminhos no Swagger, e 11 rotas literais ficam depois de uma rota `:id` do mesmo controller (#8).

## Solução

### Os arquivos

- **Uma pasta por tag**, `src/asset/resources/<slug>/`. A primeira tag da operação decide o módulo (`scripts/generate-marketo-resources.py:266-270`). O slug é a tag em kebab-case, sem os parênteses: `Emails (New)` vira `emails-new` (`scripts/marketo_codegen.py:23-27`).
- **Três arquivos por pasta**: `<slug>.module.ts`, `<slug>.controller.ts` e `<slug>.service.ts` (`scripts/generate-marketo-resources.py:273-278`).
- **Os nomes vêm da tag em PascalCase**: `SnippetsModule`, `SnippetsController` e `SnippetsService`, e a propriedade `snippetsService` no controller (`scripts/generate-marketo-resources.py:105-107,224-238`).
- **A ligação.** `AssetResourcesModule` importa os 23 módulos em ordem alfabética do slug (`scripts/generate-marketo-resources.py:244-262,279-281`). `AssetModule`, escrito à mão, importa o `AssetResourcesModule` (`src/asset/asset.module.ts:5`), e o `AppModule` importa o `AssetModule` (`src/app.module.ts:2,5`).

### O module

- `controllers` e `providers` com o controller e o service da tag, e `exports` com o service (`scripts/generate-marketo-resources.py:233-237`). Os 23 módulos exportam o service.

### O controller

- **Sem prefixo.** `@Controller()` não recebe caminho (`src/asset/resources/snippets/snippets.controller.ts:13`).
- **O caminho inteiro em cada rota**, sem a barra inicial, com `{param}` trocado por `:param` (`scripts/generate-marketo-resources.py:70-71`).
- **Um método por operação**, `async`, com o nome do `operationId` do Swagger, que devolve `Promise<T>` com o tipo da resposta 2xx (`scripts/generate-marketo-resources.py:88-101,114,144-145`). São 220 decorators: 81 `@Get` e 139 `@Post`.
- **Os parâmetros vêm do `in` do Swagger** (`scripts/generate-marketo-resources.py:33-39,81-85`):
  - `path` vira `@Param('<nome>')`;
  - `query` vira `@Query('<nome>')`;
  - `body` vira `@Body()`, e `formData` vira `@Body('<nome>')`;
  - `header` vira `@Headers('<nome>')`.

  Os obrigatórios vêm antes dos opcionais (`scripts/generate-marketo-resources.py:122-127`).
- **Sem pipe nem validação.** `@Param('id') id: number` não passa por `ParseIntPipe` (`src/asset/resources/snippets/snippets.controller.ts:19`), e nada valida o corpo ([ADR 0006](../../decisions/0006-dtos-as-typescript-interfaces.md)). O tipo só vale para o TypeScript.
- **O método só delega** ao service, com o mesmo nome e os mesmos argumentos (`scripts/generate-marketo-resources.py:146`).
- **A ordem das rotas é a ordem dos caminhos no Swagger** (`scripts/generate-marketo-resources.py:267-270`). Uma rota literal declarada depois de uma rota com parâmetro do mesmo método pode nunca ser alcançada ([rota literal declarada depois de uma rota com parâmetro](../anti-patterns/literal-route-after-param-route.md)).

### O service

- **`@Injectable()`, um método por operação**, com o nome do método do controller e a assinatura `(..._arguments: unknown[])`. Os argumentos são ignorados (`scripts/generate-marketo-resources.py:192-196,215`).
- **O corpo devolve a factory** da definição da primeira resposta 2xx com `$ref` (`scripts/generate-marketo-resources.py:88-101,186-189`). Sem `$ref`, o gerador emitiria `return undefined as never` (`scripts/generate-marketo-resources.py:191`), e nenhum service tem isso hoje.
- **O envelope é o caso comum.** 186 dos 220 métodos devolvem uma factory `makeResponseOf*`. Dos outros 34, 33 devolvem tipos com `success` e `requestId`, mas sem `errors` nem `warnings`, como `DeleteResponse`; só `ModelResponse` é `{}` (`src/asset/asset-definitions/responses/model-response.ts:1`).

### Os imports

- Os tipos entram com `import type` de `../../asset-definitions/…`, e as factories, de `../../asset-mocks/factories/…` (`src/asset/resources/snippets/snippets.service.ts:2-10`).
- O gerador ainda emite `../../../` nos dois (`scripts/generate-marketo-resources.py:59,63`). É a divergência da #7.

### Exemplo

O recurso `Snippets`, cortado numa operação:

```ts
// src/asset/resources/snippets/snippets.module.ts:5-10
@Module({
  controllers: [SnippetsController],
  providers: [SnippetsService],
  exports: [SnippetsService],
})
export class SnippetsModule {}

// src/asset/resources/snippets/snippets.controller.ts:13-23
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
  // …
}

// src/asset/resources/snippets/snippets.service.ts:12-18
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
- Nos módulos escritos à mão, `AppModule` e `AssetModule`, que não saem do gerador.
- Como prova de que uma rota responde: a forma não garante que a requisição chega ao próprio handler (#8).

## Decisões relacionadas

- [0005: NestJS sobre Express, com um módulo por tag](../../decisions/0005-nestjs-express-one-module-per-tag.md)
- [0004: O Swagger como fonte única, com o código gerado commitado](../../decisions/0004-swagger-as-single-source-with-committed-generated-code.md)
- [0006: DTOs como interfaces TypeScript](../../decisions/0006-dtos-as-typescript-interfaces.md)
- [0007: Factories faker com overrides e seed](../../decisions/0007-faker-factories-with-overrides-and-seed.md)
- [0009: Comportamento ao lado do código gerado, nunca dentro](../../decisions/0009-behaviour-beside-generated-code.md)

## Status

- **Criado**: 2026-09-25 (Fase: Build), registro retroativo de `0c8e760`..`fb4a804` (#4)
- **Status**: Active
