# Feature: Desligar a telemetria de instalação do Scarf

## Declaração de intenção

O mock é um serviço de loopback, e a [ADR 0010](../decisions/0010-loopback-only-by-default.md) decidiu que, por padrão, ele não manda nada para fora da máquina. A #9 fechou isso para o runtime e deixou a instalação de fora. Todo `npm ci` ou `npm install` roda o `postinstall` do `@scarf/scarf` 1.4.0, que chega por `@nestjs/swagger` → `swagger-ui-dist@5.33.0` e manda um `POST /package-event/install` para `scarf.sh`, com plataforma, arquitetura, versão do Node e hashes do nome do pacote raiz. Isso acontece em cada `npm ci` do CI, do dono e dos agentes.

Esta feature desliga esse evento pelo próprio `package.json`, sem variável de ambiente, para que valha em qualquer máquina que instale o projeto. O plano vigente e o Approve do dono estão na #20.

## Critérios de aceite

- [x] Um `npm ci` com o `package.json` do repositório, sem variável nenhuma, não manda o evento do Scarf, medido com o `scarf.sh` redirecionado para loopback, numa cópia fora de um caminho com espaço.
- [x] Um teste falha se o opt-out sair do `package.json`, ou se o valor deixar de ser exatamente `false`.
- [x] `npm install --package-lock-only` não muda o lockfile.
- [x] O intent, a ADR 0010, o project intent e o changelog registram a mudança. `npm run check`, o e2e e o gate passam.

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

## Resultados

Os commits seguem os passos do plano: o intent (`6b9a497`), o opt-out e a guarda (`adb23cd`) e este Learn.

- **O que entrou.** `"scarfSettings": {"enabled": false}` no fim do `package.json` e um caso em `test/runtime-defaults.spec.ts` que exige o valor `false`. O teste falha sem a chave e com a string `"false"`, e passa com o booleano. O lockfile não mudou.
- **Medido na branch**, numa cópia do `package.json` e do `package-lock.json` num caminho sem espaço, com `SCARF_LOCAL_PORT` apontado para um listener local: com o `package.json` de `e5b013c`, o `npm ci` mandou 1 `POST /package-event/install` (623 bytes) e imprimiu o aviso do Scarf; com o da branch, 0 requisições e nenhum aviso. `npm install --package-lock-only` não mudou o lockfile nas duas cópias.
- **Onde se afastou do plano.**
  - O plano punha a chave no `package.json` sem dizer onde. No topo, ela deslocaria umas 20 citações `package.json:N` das ADRs 0004, 0005, 0007 e 0008, do glossário e do pattern [Gerar e conferir](../knowledge/patterns/generate-and-check.md). No fim do arquivo, nenhuma linha citada muda.
  - A guarda dos scripts de instalação no lockfile, a recomendação 2 do plano, ficou fora por decisão do dono e entrou como alternativa rejeitada na [ADR 0010](../decisions/0010-loopback-only-by-default.md).
- **O caminho com espaço.** O `report.js` roda `cd <caminho> && npm ls` sem aspas. Num caminho com espaço, como o do checkout do dono, o `cd` quebra, e o script desiste sem mandar nada e sem avisar, fora com `SCARF_VERBOSE=true`. No checkout do dono, o `npm rebuild @scarf/scarf` não mandou nada (medido); o CI e qualquer caminho sem espaço mandavam.

## Status

- **Criado**: 2026-09-28 (Fase: Intent), do plano aprovado na issue #20 (#20)
- **Status**: Completed
- **Atualizado**: 2026-09-28 (Fase: Learn), critérios cumpridos na branch `feature/20-scarf-opt-out`, com os Resultados e a ADR 0010 atualizada (#20)
