# Anti-pattern: Rota literal declarada depois de uma rota com parâmetro

## Resumo

Uma rota literal registrada depois de uma rota com parâmetro que também casa com ela nunca chega ao próprio handler.

## Problema

- **O gerador emitia as rotas na ordem do Swagger.** `3ddceb4:scripts/generate-marketo-resources.py:340-343` percorria os caminhos na ordem do documento e agrupava as operações por tag. Nada punha os segmentos literais antes dos segmentos com parâmetro (#8).
- **13 rotas literais vinham depois de uma rota com parâmetro que casa com elas**, todas no mesmo controller. A varredura da #4 achou as 11 de assets com o `match()` do path-to-regexp 8.4.2, a versão travada no lockfile (`package-lock.json:3996-3997`), e a #6 trouxe as 2 de `lead-database`:

  | Controller | Rota com parâmetro (linha em `3ddceb4`) | Rotas literais depois dela (linha em `3ddceb4`) |
  | --- | --- | --- |
  | `smart-campaigns` | `GET smartCampaign/:id.json` (29) | `byName.json` (52), `rules.json` (82), `flowSteps.json` (87), `flowStepTypes.json` (92) |
  | `smart-lists` | `GET smartList/:id.json` (24) | `byName.json` (32), `rules.json` (74) |
  | `static-lists` | `GET staticList/:id.json` (21) | `byName.json` (67) |
  | `emails` | `GET email/:id.json` (45) | `ccFields.json` (246) |
  | `emails-new`, `email-templates-new` e `fragments-new` | `POST v2/<tipo>/:id/delete` (149) | `v2/<tipo>/bulk/delete` (193) |
  | `custom-objects`, de `lead-database` | `GET` e `POST customobjects/:customObjectName.json` (37 e 58) | `GET` e `POST customobjects/schema.json` (89 e 97) |

  A tabela omite o prefixo das rotas: `rest/asset/v1/` antes das v1 de assets, `rest/asset/` antes das que começam com `v2/` e `rest/v1/` antes das de `lead-database`. As linhas dos controllers de assets estão em `src/asset/resources/`, e a de `custom-objects` em `src/lead-database/resources/`.
- **A rota com parâmetro vencia.** O Express entrega a requisição ao primeiro handler registrado cuja rota casa, e `:id` aceita `byName`, `rules`, `ccFields`, `bulk` ou `schema`. Medido na #4, com cada método de service trocado por um que devolve o próprio nome: as 11 chamadas de assets chegavam ao handler da rota `:id`. Medido de novo na #6 e na #8, pelo router do Express e por HTTP, com as 2 de `lead-database`.
- **Entre controllers, só a ordem dos módulos salva.** `GET form/fields.json` e `GET form/programMemberFields.json`, de `form-fields/`, também casam com `GET form/:id.json`, de `forms/`. Elas chegam ao próprio handler porque o `FormFieldsModule` é importado antes do `FormsModule` (`src/asset/resources/asset-resources.module.ts:39-40`), na ordem alfabética que o gerador dá (`scripts/generate-marketo-resources.py:394-396`). Renomear uma tag pode inverter isso (inferido; confirmar).
- **Nada recusava o id errado.** `@Param('id') id: number` não tem `ParseIntPipe` (`3ddceb4:src/asset/resources/smart-campaigns/smart-campaigns.controller.ts:31`), e o service ignora os argumentos e devolve uma factory. `byName.json` respondia 200 pelo handler da rota `:id`, sem erro. Em `smartCampaign`, as duas rotas devolvem o mesmo tipo, `ResponseOfSmartCampaignResponseWithFlow`, então nem a forma da resposta denunciava o erro.
- **O risco crescia com o comportamento.** Quando o mock ganhar estado, como pede a Track A, `byName.json` buscaria um recurso de id `byName` (inferido; confirmar).

## O que fazer em vez disso

- **Uma rota vem antes da primeira rota que a capturaria.** Como o código é gerado, a ordem se corrige no gerador, e a saída é regenerada ([Gerar e conferir](../patterns/generate-and-check.md)). Desde a #8, `order_routes()` mantém a ordem do Swagger e só sobe a rota que seria capturada para logo antes da rota que a captura, e a geração falha quando duas rotas se capturam uma à outra (`scripts/generate-marketo-resources.py:72-108`, chamada em `:388`). Reordenar os controllers à mão é [editar código gerado à mão](hand-editing-generated-code.md).
- **Um teste impede a volta do erro.** O `test/route-order.e2e-spec.ts` exige que, para cada rota do app montado, a primeira camada do router que casa com uma requisição de exemplo seja a própria. Ele lê a ordem real de registro, então pega também o caso entre controllers. E um e2e por HTTP confere, com `vi.spyOn`, o handler que cada uma das 13 rotas e as 2 de `form-fields` alcançam.
- **A forma da resposta não prova a rota.** Para saber se uma requisição chegou ao próprio handler, observe o handler, não o corpo.
- Veja [A forma de um módulo de recurso](../patterns/resource-module-shape.md), [A fronteira do código gerado](../patterns/generated-code-boundary.md) e a [ADR 0005](../../decisions/0005-nestjs-express-one-module-per-tag.md).

## Exemplo do erro

```ts
// 3ddceb4:src/asset/resources/smart-campaigns/smart-campaigns.controller.ts
@Get('rest/asset/v1/smartCampaign/:id.json')    // :29, declarada primeiro
async getSmartCampaignByIdUsingGET(@Param('id') id: number, ...)

@Get('rest/asset/v1/smartCampaign/byName.json') // :52, e `:id` também casa com `byName`
async getSmartCampaignByNameUsingGET(@Query('name') name: string, ...)
```

## Status

- **Criado**: 2026-09-25 (Fase: Build), registro retroativo de `0c8e760`..`fb4a804` (#4)
- **Status**: Active
- **Atualizado**: 2026-09-26 (Fase: Build), as citações dos arquivos gerados e dos geradores seguiram as linhas novas, depois do cabeçalho de gerado (#7)
