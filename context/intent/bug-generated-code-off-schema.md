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

- **Array de topo.** O `render()` dos geradores de definições e de factories supõe que todo schema de topo é um objeto: ele só lê `properties` e `allOf` (`e5b013c:scripts/generate-marketo-definitions.py:82-132`, `e5b013c:scripts/generate-marketo-factories.py:183-232`). A [ADR 0006](../decisions/0006-dtos-as-typescript-interfaces.md) diz que todo DTO é uma `export interface`.
- **Resposta string.** O `operation_response()` só monta a resposta de um `$ref` ou de um array de `$ref` (`e5b013c:scripts/generate-marketo-resources.py:164-192`), e o resto vira `return undefined as never` (`:315`). Uma string devolvida por um handler Nest sai como `text/html`, e o documento declara `produces: application/json`.
- **Headers.** Nenhum gerador lê os `headers` das respostas.
- **Multipart.** O Nest sobre Express só monta os parsers de JSON e de urlencoded. O gerador mapeia `formData` para `@Body(...)` (`e5b013c:scripts/generate-marketo-resources.py:37-42`), e sem parser de multipart o `req.body` fica vazio.

## Abordagem da correção

O plano vigente e o Approve estão na #24. O dono seguiu todas as recomendações: middleware escrito à mão, `mockRequestId()` no header, sem limite de upload, `Person` e `CustomObject` incluídos e uma PR só. A branch é `fix/24-codigo-fora-do-schema`, cortada de `origin/main` em `e5b013c`.

- **Os testes primeiro.** `test/response-schema.e2e-spec.ts` confere cada uma das 388 operações contra o 2xx documentado: o status, o corpo contra o schema e os headers. As 10 exceções do documento ficam numa lista nomeada. `test/multipart.e2e-spec.ts` deriva do documento as operações multipart e confere que as partes chegam ao service. Os dois testes falham antes da correção.
- **Os geradores.**
  - Um schema de topo que não é objeto, ou é um objeto só com `additionalProperties`, vira `export type X = …`.
  - A factory de um array de topo devolve um array, e o override troca o array inteiro.
  - Uma resposta 2xx primitiva ganha um valor faker e sai como JSON.
  - Cada header declarado na resposta 2xx é enviado, com o `mockRequestId()` num header string.
  - A saída é regenerada, nunca editada à mão ([gerar e conferir](../knowledge/patterns/generate-and-check.md)).
- **O multipart, ao lado do gerado.** Um interceptor global em `src/multipart/`, importado no `AppModule` pelo `MultipartModule`, roda o `multer().any()` com memória como storage e põe cada arquivo em `req.body[<nome da parte>]`, sem limite de tamanho ([ADR 0009](../decisions/0009-behaviour-beside-generated-code.md), [ADR 0010](../decisions/0010-loopback-only-by-default.md), [ADR 0014](../decisions/0014-multipart-read-by-a-hand-written-interceptor.md)). O plano dizia middleware, e o dono trocou pelo interceptor no Build (Resultados).

## Critérios de aceite

- [x] `GET /rest/v1/leads/describe2.json` e `GET /rest/v1/programs/members/describe.json` respondem `searchableFields` como array de arrays de string.
- [x] `POST /userservice/management/v1/users/invite.json` responde 200 com uma string JSON e `content-type: application/json`.
- [x] Os 7 POSTs de Data Ingestion respondem 202 com um `X-Request-Id` não vazio.
- [x] `test/response-schema.e2e-spec.ts` percorre as 388 operações e confere o status, o corpo contra o schema 2xx e os headers declarados. Só as 10 exceções do `status` ficam listadas, e o teste falha se uma delas sobrar. Ele falha antes da correção e passa depois.
- [x] `test/multipart.e2e-spec.ts` prova que as partes de cada operação `multipart/form-data` chegam ao service, inclusive o `file` de `POST /bulk/v1/leads.json` como arquivo com o conteúdo enviado, e que os POSTs urlencoded e JSON continuam recebendo o corpo. Ele falha antes da correção e passa depois.
- [x] A saída regenerada vem num commit só dela, e um segundo `npm run generate:all` não muda nenhum arquivo.
- [x] `npm run check`, o e2e e o gate passam.
- [x] O intent, as ADRs 0013 e 0014, as ADRs 0006 e 0007 e o changelog registram a regra e a medição.

## Decisões relacionadas

- [ADR 0004: O Swagger como fonte única, com o código gerado commitado](../decisions/0004-swagger-as-single-source-with-committed-generated-code.md)
- [ADR 0006: DTOs como interfaces TypeScript](../decisions/0006-dtos-as-typescript-interfaces.md)
- [ADR 0007: Factories faker com overrides e seed](../decisions/0007-faker-factories-with-overrides-and-seed.md)
- [ADR 0009: Comportamento ao lado do código gerado, nunca dentro](../decisions/0009-behaviour-beside-generated-code.md)
- [ADR 0013: Definição de topo sem membros vira alias de tipo, e a factory dela devolve o valor inteiro](../decisions/0013-top-level-definitions-without-members-as-type-aliases.md)
- [ADR 0014: O corpo multipart lido num interceptor escrito à mão](../decisions/0014-multipart-read-by-a-hand-written-interceptor.md)

## Resultados

Os commits seguem os passos do plano: o intent (`34e3bbb`), os testes que falham (`9a37fc7`), o gerador de definições (`52733e5`), o de factories (`608540f`), a resposta primitiva (`d25becd`), os headers (`27ebca4`), a saída regenerada (`9371212`), o multipart (`7a274eb`), as decisões e as docs (`deace73`) e este Learn.

- **A causa raiz se confirmou nos quatro casos.** Na cabeça dos testes (`9a37fc7`), antes da correção, o `test/response-schema.e2e-spec.ts` falhou em 10 das 390 linhas: as 2 de `searchableFields`, a de `invite.json` e as 7 de Data Ingestion. O `test/multipart.e2e-spec.ts` falhou em 10 das 15: as 9 operações com partes e o teste do CSV. Os controles urlencoded e JSON e as 2 operações sem parte já passavam.
- **As 10 exceções do documento se confirmaram**, pelo nome da definição e da propriedade: as 9 operações que respondem `ObjectMetaData` e `landingPage/{id}/fullContent.json`. O teste exige as 10, e nenhuma outra.
- **Os geradores.**
  - `is_type_alias()` decide quem vira alias (`scripts/marketo_codegen.py:200-212`), e `render_alias()` o emite (`scripts/generate-marketo-definitions.py:142-154`);
  - `render_value()` gera a factory que devolve o valor inteiro (`scripts/generate-marketo-factories.py:184-210`);
  - `PRIMITIVE_VALUES` dá o valor de uma resposta primitiva (`scripts/generate-marketo-resources.py:49-54`), e o controller a manda como JSON (`:307-308,317-325`);
  - `success_headers()` e `header_value()` (`:145-158`) dão os headers ao controller (`:291-303`).
- **A saída.** `npm run generate:all` mudou 11 arquivos gerados: as 3 definições (`LeadAttribute2SearchableFields`, `Person` e `CustomObject`), a factory de `LeadAttribute2SearchableFields`, o controller e o service de `user-management` e 5 controllers de Data Ingestion, com os 7 POSTs. Um segundo `generate:all` não mudou nada, e o `check:all` passa.
- **O multipart saiu num interceptor, não num middleware.** O middleware do plano, registrado com `forRoutes('{*splat}')`, virou uma rota do Express que casa com toda requisição, e os e2e da #6 e da #8 falharam. O dono escolheu no Build o interceptor global, `APP_INTERCEPTOR`, com o mesmo `multer().any()` e o mesmo resultado em `req.body` ([ADR 0014](../decisions/0014-multipart-read-by-a-hand-written-interceptor.md), [anti-pattern](../knowledge/anti-patterns/nest-middleware-as-a-catch-all-route.md)). Um corpo multipart malformado responde 400, com um teste.
- **As dependências.** O `multer` entrou em `dependencies` com `^2.2.0`, e o lockfile continua na 2.2.0. Um `npm install multer` sem versão teria puxado a 2.4.0 e duplicado o pacote. O `@types/multer` 2.3.0 entrou em `devDependencies`, porque o multer 2.2 não traz tipos. O plano não o citava.
- **O teste de conformidade falhou de forma intermitente até escutar uma vez só.** Com o supertest abrindo uma porta efêmera por requisição, 2 de 5 execuções tiveram uma operação a mais com `403 text/plain`, vinda de outro processo local ([anti-pattern](../knowledge/anti-patterns/a-new-ephemeral-port-per-supertest-request.md)). Com o app escutando em `127.0.0.1` numa porta só, as execuções seguintes deram sempre as mesmas 10 falhas antes da correção.
- **As citações.** Os geradores, o `AppModule`, o `package.json` e o lockfile mudaram de tamanho. Um remapeamento pelo diff desde `e5b013c` moveu 103 citações de `context/` cujas linhas não mudaram. As 6 que caíam em trechos mudados foram refeitas à mão, e amostras das movidas foram conferidas contra o código. O changelog e os intents ficaram como estavam, e as citações deste intent levam `e5b013c:`.
- **Depois da correção**, o e2e passa com 439 testes em 5 arquivos. O `npm run check` rodou com a máquina carregada, com média de carga entre 22 e 25. Na primeira rodada, 11 dos 3.751 testes unitários falharam por tempo, todos nos testes dos hooks e do gate, 8 deles no limite de 120 s. Os 3 arquivos rodados de novo passaram inteiros, com 1.033 testes, e `check:context`, `build` e `check:all` também.

## Status

- **Criado**: 2026-09-28 (Fase: Intent), do plano aprovado na issue #24 (#24)
- **Status**: Resolved
- **Atualizado**: 2026-09-28 (Fase: Learn), os quatro casos foram corrigidos, três nos geradores e o multipart num interceptor escrito à mão; os critérios foram medidos, e o status passou a `Resolved` (#24)
