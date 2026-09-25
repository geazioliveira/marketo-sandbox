# Feature: Publicar a regra de validação de planos no Context Mesh

## Declaração de intenção

O Context Mesh e o fluxo do loop já estão em `main`, mas a orientação mais recente do dono sobre as labels está apenas na branch da #5. Ao publicar um plano numa issue em `needs-triage`, o agente deve movê-la para `ready-for-human`, sinalizando que o plano aguarda validação. Essa regra precisa chegar a `main` numa PR própria, para que todos os clones e agentes a leiam antes da implementação dos hooks.

## Critérios de aceite

- [x] `AGENTS.md`, o fluxo, a ADR 0001, o pattern do gate, o glossário e a mensagem do gate distinguem a transição do agente dos atos exclusivos do dono.
- [x] A PR traz somente a regra compartilhada e não inclui o intent nem a implementação dos hooks da #5.
- [x] O intent e o changelog registram o resultado; `npm run check:context`, os testes pertinentes e o gate passam.
- [ ] A PR fecha somente a #17, com os checks exigidos verdes, uma revisão do Copilot na cabeça e nenhuma thread aberta antes do merge.
- [ ] A branch da #5 é reconciliada com o merge desta PR antes de sua própria PR.

## Abordagem técnica

A branch `feature/17-publicar-regra-labels-loop` nasce de `origin/main`. Depois deste primeiro commit, que toca apenas `context/intent/`, as mudanças compartilhadas do commit `3a92ee1` são portadas sem o intent da #5. O gate continua reservando `# Owner Approve` e a aplicação de `ready-for-agent` ao dono. O Learn atualiza este intent e `context/evolution/changelog.md` antes de a PR sair de draft.

## Perguntas em aberto

Nenhuma. O dono aprovou na #17 a recomendação de manter esta PR restrita à regra nova e deixar os hooks na #5.

## Decisões relacionadas

- [ADR 0001: Context Mesh no repositório e loop issue-first](../decisions/0001-context-mesh-in-the-repository.md)
- [ADR 0002: Enforcement soft do loop no GitHub Free](../decisions/0002-soft-enforcement-on-github-free.md)

## Patterns relacionados

- [O gate do loop](../knowledge/patterns/loop-gate.md)
- [Ciclo de vida de issue e branch](../knowledge/patterns/issue-branch-lifecycle.md)

## Resultados

O primeiro commit (`ae5e24d`) trouxe só este intent. O segundo (`1b3f8f0`) levou as seis mudanças compartilhadas de `3a92ee1` para uma branch própria da #17, sem `context/intent/feature-claude-code-hooks.md` nem os hooks. A #6 já usa `enhancement` + `ready-for-human`; os relatos #7, #8 e #9 seguem em `needs-triage` enquanto não têm plano.

`npm run check` passou: lint (com um aviso preexistente em `src/app.module.ts:16`), typecheck, 1.337 testes, `check:context` (38 arquivos, 486 links internos) e build. O e2e passou (1 teste) com `OBSERVE_ENDPOINT=http://127.0.0.1:9`. Revisão da PR, veredito final e reconciliação da branch da #5 são passos posteriores a este Learn.

## Status

- **Criado**: 2026-09-25 (Fase: Intent), do plano aprovado na issue #17 (#17)
- **Status**: Completed
- **Atualizado**: 2026-09-25 (Fase: Learn), regra compartilhada isolada da #5 e checks locais concluídos; revisão e reconciliação seguem no fluxo da PR (#17)
