# Feature: Remover as sobras do starter NestJS e a telemetria padrão

## Declaração de intenção

O mock é um serviço de loopback para desenvolvimento e testes, e o lite-campaign o consome sem credenciais nem instância Marketo. Duas coisas herdadas do starter do NestJS contrariam o critério do [project intent](project-intent.md) de que, por padrão, nenhuma requisição sai da máquina e o servidor escuta em `127.0.0.1`. O `ObserveModule` manda telemetria para `observe-api.nestjs.com` mesmo com as chaves vazias, e o `app.listen` escuta em todas as interfaces. O CI e o fluxo carregam um contorno por causa disso: o `OBSERVE_ENDPOINT=http://127.0.0.1:9`.

As outras sobras confundem quem lê o projeto. São elas o nome `nest-typescript-starter`, o Hello World com os testes dele, o script `deploy`, o `@nestjs/mau`, o faker marcado como `dev` no lockfile, os arquivos fora do Prettier e o boilerplate do README.

Esta feature faz dois itens do R1 da Track A do lite-campaign: tira a telemetria padrão e põe o `HOST` com padrão `127.0.0.1`. Ela registra isso para que a Track A não os refaça. O plano vigente e o Approve do dono estão na #9.

## Critérios de aceite

- [ ] Por padrão, nenhuma requisição sai da máquina. O `@nestjs/observe` sai do código e das dependências, e um teste falha se ele voltar ao `package.json` ou a um import em `src/`.
- [ ] O servidor escuta em `HOST`, com `127.0.0.1` por padrão, e em `PORT`, com 3000 por padrão. Um teste prova o padrão e a troca pelas duas variáveis.
- [ ] O Hello World sai: o controller, o service e os dois testes. O e2e vira um smoke: `GET /rest/asset/v1/folders.json` responde 200 com `success: true`, e `GET /` responde 404.
- [ ] O pacote se chama `marketo-sandbox` e tem uma descrição do mock. O script `deploy` e o `@nestjs/mau` saem.
- [ ] `npm install --package-lock-only` não muda o lockfile, e o faker aparece nele como dependência de runtime.
- [ ] `npm run format:check` passa em `src`, `test` e `scripts`, e roda dentro do `npm run check`.
- [ ] O e2e roda no CI e no fluxo sem `OBSERVE_ENDPOINT`. O `check.yml`, o fluxo, a ADR 0002 e os testes de paridade e de drift deixam de citá-lo.
- [ ] O README perde as seções do starter e diz como escolher `HOST` e `PORT`, sem reescrever o resto.
- [ ] O intent, uma ADR nova, as ADRs afetadas, o project intent e o changelog registram a mudança. `npm run check`, o e2e e o gate passam.

## Abordagem técnica

A branch `feature/9-sobras-do-starter` nasce de `origin/main` em `610e101` e segue os passos do plano da #9, com um commit por passo:

1. **Telemetria e escuta.** O Observe sai do `AppModule` e do `NestFactory.create`. O `src/main.ts` passa a escutar no endereço devolvido por `listenAddress(process.env)`, uma função de `src/listen-address.ts`. Uma variável vazia conta como ausente, porque `HOST=` com `??` escutaria em todas as interfaces (medido: `::`).
2. **Dependências e lockfile.** O `package.json` ganha o nome e a descrição novos e perde o `@nestjs/observe`, o `@nestjs/mau` e o `deploy`. O lockfile é regenerado pelo `npm install`.
3. **O Hello World vira smoke** no `test/app.e2e-spec.ts`.
4. **Formatação.** `format` e `format:check` cobrem `src`, `test` e `scripts`, e o `format:check` entra no `npm run check` logo depois do `lint`.
5. **CI e documentação do e2e** sem o `OBSERVE_ENDPOINT`.
6. **README** sem as seções do starter, com `HOST` e `PORT`.

A guarda contra a volta da telemetria é estática: ela confere o `package.json` e os imports de `src/`. A Verificação da PR soma uma medição de rede: `node dist/main` com um preload que registra toda conexão, inclusive as das worker threads, e com o `lsof`.

## Perguntas em aberto

Nenhuma. O dono aprovou as quatro recomendações do plano: remover o Observe, trazer o `HOST` para esta issue, construir antes da #6 e cobrir `src`, `test` e `scripts` no `format:check`. A telemetria de instalação do `@scarf/scarf`, que o plano não cobre, ficou na #20.

## Decisões relacionadas

- [ADR 0002: Enforcement soft do loop no GitHub Free](../decisions/0002-soft-enforcement-on-github-free.md)
- [ADR 0005: NestJS sobre Express, com um módulo por tag](../decisions/0005-nestjs-express-one-module-per-tag.md)
- [ADR 0007: Factories faker com overrides e seed](../decisions/0007-faker-factories-with-overrides-and-seed.md)
- [ADR 0008: A toolchain](../decisions/0008-toolchain.md)

## Patterns relacionados

- [A fronteira do código gerado](../knowledge/patterns/generated-code-boundary.md)
- [Revisão classificada por risco](../knowledge/patterns/risk-classified-review.md)
- [Ciclo de vida de issue e branch](../knowledge/patterns/issue-branch-lifecycle.md)

## Resultados

- Escrito no Learn.

## Status

- **Criado**: 2026-09-26 (Fase: Intent), do plano aprovado na issue #9 (#9)
- **Status**: In Progress
- **Atualizado**: 2026-09-26 (Fase: Build), branch `feature/9-sobras-do-starter` cortada de `610e101` (#9)
