# Bug: Rotas literais sombreadas por rotas com parâmetro

## Descrição

- **Esperado.** Uma requisição chega ao handler da rota que ela nomeia. `GET rest/asset/v1/smartCampaign/byName.json?name=x` chega a `getSmartCampaignByNameUsingGET`.
- **Atual.** No Express, vence a primeira rota registrada que casa com a requisição, e `:id` aceita `byName` tanto quanto `12`. Com as cinco APIs em `main` (`3ddceb4`), 13 das 388 rotas caem numa rota com parâmetro do mesmo método, declarada antes delas no mesmo controller:

  | Controller | Rota com parâmetro | Rotas literais que ela captura |
  | --- | --- | --- |
  | `smart-campaigns` | `GET rest/asset/v1/smartCampaign/:id.json` | `byName.json`, `rules.json`, `flowSteps.json`, `flowStepTypes.json` |
  | `smart-lists` | `GET rest/asset/v1/smartList/:id.json` | `byName.json`, `rules.json` |
  | `static-lists` | `GET rest/asset/v1/staticList/:id.json` | `byName.json` |
  | `emails` | `GET rest/asset/v1/email/:id.json` | `ccFields.json` |
  | `emails-new`, `email-templates-new` e `fragments-new` | `POST rest/asset/v2/<tipo>/:id/delete` | `bulk/delete` |
  | `custom-objects`, de Lead Database | `GET` e `POST rest/v1/customobjects/:customObjectName.json` | `GET` e `POST schema.json` |

  A resposta nem sempre denuncia o erro: todo service ignora os argumentos e devolve uma factory, e em `smartCampaign/byName.json` as duas rotas devolvem o mesmo tipo. Entre controllers, `GET rest/asset/v1/form/fields.json` e `form/programMemberFields.json`, de `form-fields`, chegam ao próprio handler só porque o `FormFieldsModule` é importado antes do `FormsModule`, na ordem alfabética do gerador.
- **Reprodução.** O `test/route-order.e2e-spec.ts` desta issue, rodado antes da correção: o teste do roteador lista as 13 rotas, e 13 linhas do e2e por HTTP veem o handler da rota com parâmetro ser chamado no lugar do próprio.

## Causa raiz

- O gerador de resources emite as rotas de cada tag na ordem dos caminhos do Swagger (`ResourceGenerator.files()`, em `scripts/generate-marketo-resources.py`), e nada põe uma rota que seria capturada antes da rota que a captura. O Swagger lista `smartCampaign/{id}.json` antes de `smartCampaign/byName.json`.
- No Express 5.2.1, com o path-to-regexp 8.4.2, as versões do lockfile, vence a primeira rota declarada que casa.
- Nenhum teste conferia que uma requisição chega ao próprio handler. A forma da resposta não serve de prova, e o `test/marketo-api.e2e-spec.ts` da #6 confere que cada operação tem uma rota registrada, não para qual handler a requisição vai.

## Abordagem da correção

- **A regra de ordem, no gerador.** Dentro de cada tag, a ordem do Swagger se mantém, com uma exceção: uma rota que uma rota anterior do mesmo método capturaria vai para logo antes da primeira rota que a captura. Uma rota captura outra quando o caminho da outra, com os parâmetros trocados por `1`, casa com o padrão dela, em que cada `{param}` aceita um segmento.
- **O gerador se confere.** Depois de ordenar, se uma rota ainda captura uma rota posterior, a geração falha e mostra o par, em vez de emitir uma rota sombreada.
- **Controller e service seguem a mesma ordem**, e a saída é regenerada pelo gerador, nunca editada à mão ([Gerar e conferir](../knowledge/patterns/generate-and-check.md)).
- **A ordem dos módulos continua alfabética.** O caso de `form-fields` fica protegido pelo teste do roteador, que lê a ordem real de registro do app inteiro.
- **Os testes**, em `test/route-order.e2e-spec.ts`: um sobre o roteador montado, que exige que a primeira camada que casa com uma requisição de exemplo de cada rota seja a própria; e um e2e por HTTP, com `vi.spyOn` no método de service de cada rota e no da rota que a capturava.

O plano vigente e o Approve do dono estão na #8. A branch é `fix/8-rotas-sombreadas`, cortada de `origin/main` em `3ddceb4`, depois do merge da #6, como pedia a resposta à pergunta 1 do plano.

## Critérios de aceite

- [ ] Um teste e2e prova que `GET rest/asset/v1/smartCampaign/byName.json` chega a `getSmartCampaignByNameUsingGET`, e não a `getSmartCampaignByIdUsingGET`. O mesmo teste prova isso para cada uma das 13 rotas e para `form/fields.json` e `form/programMemberFields.json`. Ele falha antes da correção e passa depois.
- [ ] Um teste sobre o roteador montado garante que toda rota do app chega ao próprio handler: nenhuma rota vem depois de outra que case com ela, do mesmo controller ou de outro. Ele falha antes da correção, listando as 13, e passa depois.
- [ ] O teste do roteador não passa em vazio. Ele falha se a pilha tiver menos rotas do que as operações de `docs/marketo-swagger-*.json`, ou se o matcher do Express não existir.
- [ ] `scripts/generate-marketo-resources.py` ordena as rotas pela regra acima e falha quando sobra uma rota capturada. A saída regenerada vem num commit separado, e `npm run check:all` passa.
- [ ] `npm run check`, o e2e e o gate passam.
- [ ] O intent do bug, a ADR 0005, o anti-pattern `literal-route-after-param-route`, o pattern `resource-module-shape` e o changelog registram a regra e a medição.

## Decisões relacionadas

- [ADR 0004: O Swagger como fonte única, com o código gerado commitado](../decisions/0004-swagger-as-single-source-with-committed-generated-code.md)
- [ADR 0005: NestJS sobre Express, com um módulo por tag](../decisions/0005-nestjs-express-one-module-per-tag.md)

## Status

- **Criado**: 2026-09-26 (Fase: Intent), do plano aprovado na issue #8 (#8)
- **Status**: In Progress
- **Atualizado**: 2026-09-26 (Fase: Build), branch `fix/8-rotas-sombreadas` cortada de `3ddceb4`, depois do merge da #6 (#8)
