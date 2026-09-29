# Bug: Código gerado fora do schema e upload multipart que não chega ao handler

## Descrição

- **Esperado.** Cada rota responde o que o documento declara no 2xx (o status, o corpo e os headers) e entrega ao handler o corpo que recebeu, também em `multipart/form-data`.
- **Atual.** Medido em `e5b013c`, quatro formas do documento saem do gerador diferentes do que ele diz, e as quatro passam no `check:all` e no e2e da #6:
  - **Array de topo.** `LeadAttribute2SearchableFields` é `{type: array, items: string}` (`docs/marketo-swagger-mapi.json:7381`) e sai como `export interface LeadAttribute2SearchableFields {}`. A factory devolve `{}`, e `GET /rest/v1/leads/describe2.json` e `GET /rest/v1/programs/members/describe.json` respondem `searchableFields: [{}, …]`. `Person` e `CustomObject`, de Data Ingestion, só têm `additionalProperties` e também saem como `export interface X {}`.
  - **Resposta string.** O 200 de `POST /userservice/management/v1/users/invite.json` é `{type: string}`, e a rota responde 200 sem corpo.
  - **Headers de resposta.** Os 7 POSTs de Data Ingestion declaram `X-Request-Id` no 202 (o primeiro em `docs/marketo-swagger-data-ingestion.json:116`), e o mock não o envia.
  - **Multipart.** Os 11 POSTs que consomem `multipart/form-data` recebem `undefined` no lugar das partes: 3 bulk imports de Lead Database, com `file` declarado `type: file` em `formData`, e 8 de assets, 5 com o arquivo como propriedade `string` de um `in: body`, 1 com `content` em `formData` e 2 sem parâmetro de corpo.
- **Reprodução.**
  - Um protótipo do teste de conformidade mandou uma requisição a cada uma das 388 operações e falhou em 20. Dez são os três primeiros casos. As outras 10 são o próprio documento que se contradiz: as 9 operações que respondem `ObjectMetaData`, de Lead Database, e `GET /rest/asset/v1/landingPage/{id}/fullContent.json` (`GetLandingPageFullContentResponse`) exigem um `status` que não definem.
  - Com um `vi.spyOn` no service, `POST /bulk/v1/leads.json?format=csv` com `leads.csv` anexado responde 200, e o service recebe `file` como `undefined`. `POST /rest/asset/v1/files.json` entrega `undefined` como corpo.

## Causa raiz

- **Array de topo.** O `render()` dos geradores de definições e de factories supõe que todo schema de topo é um objeto: ele só lê `properties` e `allOf` (`scripts/generate-marketo-definitions.py:82-132`, `scripts/generate-marketo-factories.py:183-232`). A [ADR 0006](../decisions/0006-dtos-as-typescript-interfaces.md) diz que todo DTO é uma `export interface`.
- **Resposta string.** O `operation_response()` só monta a resposta de um `$ref` ou de um array de `$ref` (`scripts/generate-marketo-resources.py:164-192`), e o resto vira `return undefined as never` (`:315`). Uma string devolvida por um handler Nest sai como `text/html`, e o documento declara `produces: application/json`.
- **Headers.** Nenhum gerador lê os `headers` das respostas.
- **Multipart.** O Nest sobre Express só monta os parsers de JSON e de urlencoded. O gerador mapeia `formData` para `@Body(...)` (`scripts/generate-marketo-resources.py:37-42`), e sem parser de multipart o `req.body` fica vazio.

## Abordagem da correção

O plano vigente e o Approve estão na #24. O dono seguiu todas as recomendações: middleware escrito à mão, `mockRequestId()` no header, sem limite de upload, `Person` e `CustomObject` incluídos e uma PR só. A branch é `fix/24-codigo-fora-do-schema`, cortada de `origin/main` em `e5b013c`.

- **Os testes primeiro.** `test/response-schema.e2e-spec.ts` confere cada uma das 388 operações contra o 2xx documentado: o status, o corpo contra o schema e os headers. As 10 exceções do documento ficam numa lista nomeada. `test/multipart.e2e-spec.ts` deriva do documento as operações multipart e confere que as partes chegam ao service. Os dois testes falham antes da correção.
- **Os geradores.**
  - Um schema de topo que não é objeto, ou é um objeto só com `additionalProperties`, vira `export type X = …`.
  - A factory de um array de topo devolve um array, e o override troca o array inteiro.
  - Uma resposta 2xx primitiva ganha um valor faker e sai como JSON.
  - Cada header declarado na resposta 2xx é enviado, com o `mockRequestId()` num header string.
  - A saída é regenerada, nunca editada à mão ([gerar e conferir](../knowledge/patterns/generate-and-check.md)).
- **O multipart, ao lado do gerado.** Um middleware em `src/multipart/`, importado no `AppModule`, roda o `multer().any()` com memória como storage e põe cada arquivo em `req.body[<nome da parte>]`, sem limite de tamanho ([ADR 0009](../decisions/0009-behaviour-beside-generated-code.md), [ADR 0010](../decisions/0010-loopback-only-by-default.md)).

## Critérios de aceite

- [ ] `GET /rest/v1/leads/describe2.json` e `GET /rest/v1/programs/members/describe.json` respondem `searchableFields` como array de arrays de string.
- [ ] `POST /userservice/management/v1/users/invite.json` responde 200 com uma string JSON e `content-type: application/json`.
- [ ] Os 7 POSTs de Data Ingestion respondem 202 com um `X-Request-Id` não vazio.
- [ ] `test/response-schema.e2e-spec.ts` percorre as 388 operações e confere o status, o corpo contra o schema 2xx e os headers declarados. Só as 10 exceções do `status` ficam listadas, e o teste falha se uma delas sobrar. Ele falha antes da correção e passa depois.
- [ ] `test/multipart.e2e-spec.ts` prova que as partes de cada operação `multipart/form-data` chegam ao service, inclusive o `file` de `POST /bulk/v1/leads.json` como arquivo com o conteúdo enviado, e que os POSTs urlencoded e JSON continuam recebendo o corpo. Ele falha antes da correção e passa depois.
- [ ] A saída regenerada vem num commit só dela, e um segundo `npm run generate:all` não muda nenhum arquivo.
- [ ] `npm run check`, o e2e e o gate passam.
- [ ] O intent, as ADRs 0012 e 0013, as ADRs 0006 e 0007 e o changelog registram a regra e a medição.

## Decisões relacionadas

- [ADR 0004: O Swagger como fonte única, com o código gerado commitado](../decisions/0004-swagger-as-single-source-with-committed-generated-code.md)
- [ADR 0006: DTOs como interfaces TypeScript](../decisions/0006-dtos-as-typescript-interfaces.md)
- [ADR 0007: Factories faker com overrides e seed](../decisions/0007-faker-factories-with-overrides-and-seed.md)
- [ADR 0009: Comportamento ao lado do código gerado, nunca dentro](../decisions/0009-behaviour-beside-generated-code.md)

## Status

- **Criado**: 2026-09-28 (Fase: Intent), do plano aprovado na issue #24 (#24)
- **Status**: In Progress
