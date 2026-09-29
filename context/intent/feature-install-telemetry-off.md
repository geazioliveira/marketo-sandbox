# Feature: Desligar a telemetria de instalação do Scarf

## Declaração de intenção

O mock é um serviço de loopback, e a [ADR 0010](../decisions/0010-loopback-only-by-default.md) decidiu que, por padrão, ele não manda nada para fora da máquina. A #9 fechou isso para o runtime e deixou a instalação de fora. Todo `npm ci` ou `npm install` roda o `postinstall` do `@scarf/scarf` 1.4.0, que chega por `@nestjs/swagger` → `swagger-ui-dist@5.33.0` e manda um `POST /package-event/install` para `scarf.sh`, com plataforma, arquitetura, versão do Node e hashes do nome do pacote raiz. Isso acontece em cada `npm ci` do CI, do dono e dos agentes.

Esta feature desliga esse evento pelo próprio `package.json`, sem variável de ambiente, para que valha em qualquer máquina que instale o projeto. O plano vigente e o Approve do dono estão na #20.

## Critérios de aceite

- [ ] Um `npm ci` com o `package.json` do repositório, sem variável nenhuma, não manda o evento do Scarf, medido com o `scarf.sh` redirecionado para loopback, numa cópia fora de um caminho com espaço.
- [ ] Um teste falha se o opt-out sair do `package.json`, ou se o valor deixar de ser exatamente `false`.
- [ ] `npm install --package-lock-only` não muda o lockfile.
- [ ] O intent, a ADR 0010, o project intent e o changelog registram a mudança. `npm run check`, o e2e e o gate passam.

## Abordagem técnica

A branch `feature/20-scarf-opt-out` nasce de `origin/main` em `e5b013c` e segue os passos do plano da #20, com um commit por passo:

1. **O opt-out e a guarda.** O `package.json` ganha `"scarfSettings": {"enabled": false}`, a forma que o `report.js` do Scarf lê no `package.json` raiz (`node_modules/@scarf/scarf/report.js:57-58`). O `test/runtime-defaults.spec.ts` ganha, dentro de `no telemetry by default`, um caso que exige o valor `false`.
2. **Learn.** A ADR 0010 passa a decidir também a instalação, com uma linha `Atualizado`. O project intent e o changelog registram a mudança.

A medição usa o `SCARF_LOCAL_PORT`, que manda o evento para `localhost` numa porta escolhida, e um listener local que conta as requisições. Ela roda numa cópia fora do checkout do dono, porque num caminho com espaço o Scarf desiste sem mandar nada.

## Perguntas em aberto

Nenhuma. O dono aprovou o plano com as recomendações 1 e 3: registrar na ADR 0010 e não pôr variável no `check.yml`. A recomendação 2, uma guarda que fixa os pacotes com script de instalação no lockfile, ficou fora: o dono a achou controle demais.

## Decisões relacionadas

- [ADR 0010: O mock só fala com a própria máquina por padrão](../decisions/0010-loopback-only-by-default.md)
- [ADR 0008: A toolchain](../decisions/0008-toolchain.md)

## Patterns relacionados

- [Revisão classificada por risco](../knowledge/patterns/risk-classified-review.md)
- [Ciclo de vida de issue e branch](../knowledge/patterns/issue-branch-lifecycle.md)

## Status

- **Criado**: 2026-09-28 (Fase: Intent), do plano aprovado na issue #20 (#20)
- **Status**: In Progress
