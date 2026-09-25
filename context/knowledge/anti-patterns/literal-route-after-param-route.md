# Anti-pattern: Rota literal declarada depois de uma rota com parâmetro

## Resumo

Uma rota literal registrada depois de uma rota com parâmetro que também casa com ela nunca chega ao próprio handler.

## Problema

- **O gerador emite as rotas na ordem do Swagger.** `scripts/generate-marketo-resources.py:267-270` percorre `document["paths"]` na ordem do documento e agrupa as operações por tag. Nada põe os segmentos literais antes dos segmentos com parâmetro (#8).
- **11 rotas literais vêm depois de uma rota `:id` que casa com elas.** A varredura da #4 usou o `match()` do path-to-regexp 8.4.2, a versão travada no lockfile (`package-lock.json:4574-4575`). Achou as 11, todas dentro do mesmo controller:

  | Controller, em `src/asset/resources/` | Rota com parâmetro (linha) | Rotas literais depois dela (linha) |
  | --- | --- | --- |
  | `smart-campaigns/smart-campaigns.controller.ts` | `GET smartCampaign/:id.json` (21) | `byName.json` (43), `rules.json` (73), `flowSteps.json` (78), `flowStepTypes.json` (83) |
  | `smart-lists/smart-lists.controller.ts` | `GET smartList/:id.json` (16) | `byName.json` (24), `rules.json` (64) |
  | `static-lists/static-lists.controller.ts` | `GET staticList/:id.json` (13) | `byName.json` (57) |
  | `emails/emails.controller.ts` | `GET email/:id.json` (37) | `ccFields.json` (222) |
  | O controller de `emails-new/`, de `email-templates-new/` e de `fragments-new/` | `POST v2/<tipo>/:id/delete` (144) | `v2/<tipo>/bulk/delete` (185) |

  A tabela omite o prefixo das rotas: `rest/asset/v1/` antes das v1, e `rest/asset/` antes das que começam com `v2/`.
- **A rota `:id` vence.** O Express entrega a requisição ao primeiro handler registrado cuja rota casa, e `:id` aceita `byName`, `rules`, `ccFields` ou `bulk`. Medido na #4, numa cópia de `origin/main` compilada com `tsc`, com o `AssetResourcesModule` servido em loopback e cada método de service trocado por um que devolve o próprio nome: as 11 chamadas chegam ao handler da rota `:id`, e as rotas literais nunca são alcançadas. De controle, `GET smartCampaign/12.json` e `GET smartCampaigns.json` chegam ao próprio handler. A #8 fica com o teste e2e e a correção.
- **Entre controllers, só a ordem dos módulos salva.** `GET form/fields.json` e `GET form/programMemberFields.json`, de `form-fields/`, também casam com `GET form/:id.json`, de `forms/`. Na mesma medição, as duas chegam ao próprio handler, porque o `FormFieldsModule` é importado antes do `FormsModule` (`src/asset/resources/asset-resources.module.ts:36-37`), na ordem alfabética que o gerador dá (`scripts/generate-marketo-resources.py:279-281`). Renomear uma tag pode inverter isso (inferido; confirmar). A #8 não lista esse caso.
- **Nada recusa o id errado.** `@Param('id') id: number` não tem `ParseIntPipe` (`smart-campaigns.controller.ts:23`), e o service ignora os argumentos e devolve uma factory (`src/asset/resources/smart-campaigns/smart-campaigns.service.ts:24-27`). Na medição, `byName.json` responde 200 pelo handler da rota `:id`, sem erro. Em `smartCampaign`, as duas rotas devolvem o mesmo tipo, `ResponseOfSmartCampaignResponseWithFlow` (`smart-campaigns.controller.ts:25` e `:47`), então nem a forma da resposta denuncia o erro.
- **O risco cresce com o comportamento.** Hoje toda rota devolve uma factory. Quando o mock ganhar estado, como pede a Track A, `byName.json` buscaria um recurso de id `byName` (inferido; confirmar).

## O que fazer em vez disso

- **Num controller, as rotas literais vêm antes das rotas com parâmetro que casam com elas.** Como o código é gerado, a ordem se corrige no gerador, e a saída é regenerada: é o que a #8 propõe para `scripts/generate-marketo-resources.py`. Isso depende da #7: hoje o gerador de resources emite imports para pastas que não existem ([Gerar e conferir](../patterns/generate-and-check.md)). Reordenar os controllers à mão é [editar código gerado à mão](hand-editing-generated-code.md).
- **Um teste impede a volta do erro.** A #8 pede um e2e que prove que `GET smartCampaign/byName.json` chega ao próprio handler, e um teste estático que recuse uma rota literal depois de uma rota com parâmetro que case com ela.
- Veja [A forma de um módulo de recurso](../patterns/resource-module-shape.md), [A fronteira do código gerado](../patterns/generated-code-boundary.md) e a [ADR 0005](../../decisions/0005-nestjs-express-one-module-per-tag.md).

## Exemplo do erro

```ts
// src/asset/resources/smart-campaigns/smart-campaigns.controller.ts
@Get('rest/asset/v1/smartCampaign/:id.json')    // :21, declarada primeiro
async getSmartCampaignByIdUsingGET(@Param('id') id: number, ...)

@Get('rest/asset/v1/smartCampaign/byName.json') // :43, e `:id` também casa com `byName`
async getSmartCampaignByNameUsingGET(@Query('name') name: string, ...)
```

## Status

- **Criado**: 2026-09-25 (Fase: Build), registro retroativo de `0c8e760`..`fb4a804` (#4)
- **Status**: Active
