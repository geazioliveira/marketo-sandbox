# Bug: Corpo acima de 100 KiB responde 413

## Descrição

- **Esperado.** O mock aceita os corpos que o Marketo aceita. A documentação pública do Marketo diz que o sync de leads cria ou atualiza até 300 registros por chamada e que ele só responde 413 quando o payload passa de 1 MB, ou de 10 MB no Import Lead (Adobe Experience League, páginas "Leads" e "Error Codes", lidas em 2026-09-28).
- **Atual.** Todo POST com corpo JSON ou `application/x-www-form-urlencoded` acima de 100 KiB responde 413 (`{"statusCode":413,"message":"request entity too large"}`). Medido em `origin/main` `a74ca0c`, com `node dist/main`:

  | Corpo | Tamanho | `POST /rest/v1/leads.json` | `POST /subscriptions/123-ABC-456/persons` |
  | --- | ---: | ---: | ---: |
  | 100 leads | 58,1 KiB | 200 | 202 |
  | 300 leads | 175,7 KiB | 413 | 413 |

  O mesmo vale para os 103 POSTs de assets que recebem form: um `content=…` de 101 KiB em `POST /rest/asset/v1/snippet/1/content.json` dá 413. O multipart e o `text/plain` não passam por parser nenhum, então o limite não os alcança.
- **Reprodução.** O `test/body-limit.e2e-spec.ts` desta issue, rodado antes da correção: os lotes de leads, de persons e o form acima de 100 KiB recebem 413 onde esperam 200 e 202.

## Causa raiz

- O `src/main.ts` criava o app com `NestFactory.create(AppModule)`, sem opção de corpo. No `init()`, o Nest registra o `express.json()` e o `express.urlencoded({ extended: true })` sem `limit` (`node_modules/@nestjs/core/nest-application.js:114-115`, `node_modules/@nestjs/platform-express/adapters/express-adapter.js:232-237`), e o body-parser 2.3.0 do lockfile limita cada um a 100 KiB.
- Os e2e criam o app pelo `Test.createTestingModule(...).createNestApplication()`, sem passar pelo `main.ts`, e nenhum mandava um corpo acima de 100 KiB.

## Abordagem da correção

- **O limite do Marketo, nos dois parsers.** `src/body-limit.ts` exporta `bodyLimit = '1mb'` e `useBodyLimit(app)`, que registra o `json` e o `urlencoded` (com `extended: true`, como o padrão do Nest) com esse limite pelo `app.useBodyParser`. Chamado antes do `init()`, o parser dele roda antes dos padrões, e o padrão vê a requisição já lida e passa adiante (`node_modules/body-parser/lib/read.js:40-44`).
- **O `main.ts` e o e2e usam a mesma função.** O `src/main.ts` cria o app como `NestExpressApplication` e chama `useBodyLimit(app)` antes do Swagger e do `listen`. O e2e novo chama `useBodyLimit(app)` antes do `init()`. Os outros três e2e ficam como estão: o dono decidiu que um helper comum não faz sentido (pergunta 3 do plano).
- **Os testes.** `test/body-limit.e2e-spec.ts` manda 300 leads e 300 persons acima de 100 KiB, um form acima de 100 KiB, e um JSON e um form acima de 1 MiB, que devem receber 413 como no Marketo. `test/runtime-defaults.spec.ts` exige `bodyLimit` igual a `'1mb'` e o `src/main.ts` chamando `useBodyLimit(app)`.

O plano vigente e o Approve do dono estão na #25. A branch é `fix/25-limite-do-corpo`, cortada de `origin/main` em `e37705c`. O dono respondeu às quatro perguntas: o limite igual ao do Marketo, os dois parsers no mesmo limite para manter a paridade com o Marketo, nenhum helper comum para os e2e, e a decisão registrada na ADR 0005.

## Critérios de aceite

- [ ] Um e2e manda um lote de 300 leads com mais de 100 KiB em `POST /rest/v1/leads.json` e recebe 200. Ele falha antes da correção e passa depois.
- [ ] O mesmo lote em `POST /subscriptions/{munchkinId}/persons` recebe 202. Falha antes e passa depois.
- [ ] Um corpo urlencoded com mais de 100 KiB num POST de assets recebe 200. Falha antes e passa depois.
- [ ] Um corpo JSON e um urlencoded com mais de 1 MiB recebem 413.
- [ ] O `src/main.ts` e o e2e aplicam o limite pela mesma função, e um teste falha se o `main.ts` deixar de chamá-la.
- [ ] O intent do bug, a ADR 0005, o pattern da fronteira do código gerado, o README e o changelog registram a correção. `npm run check`, o e2e e o gate passam.

## Decisões relacionadas

- [ADR 0005: NestJS sobre Express, com um módulo por tag](../decisions/0005-nestjs-express-one-module-per-tag.md)
- [ADR 0010: O mock só fala com a própria máquina por padrão](../decisions/0010-loopback-only-by-default.md)

## Status

- **Criado**: 2026-09-28 (Fase: Intent), do plano aprovado na issue #25 (#25)
- **Status**: In Progress
