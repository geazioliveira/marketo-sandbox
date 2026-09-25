# Feature: Publicar a regra de validação de planos no Context Mesh

## Declaração de intenção

O Context Mesh e o fluxo do loop já estão em `main`, mas a orientação mais recente do dono sobre as labels está apenas na branch da #5. Ao publicar um plano numa issue em `needs-triage`, o agente deve movê-la para `ready-for-human`, sinalizando que o plano aguarda validação. Essa regra precisa chegar a `main` numa PR própria, para que todos os clones e agentes a leiam antes da implementação dos hooks.

## Critérios de aceite

- [ ] `AGENTS.md`, o fluxo, a ADR 0001, o pattern do gate, o glossário e a mensagem do gate distinguem a transição do agente dos atos exclusivos do dono.
- [ ] A PR traz somente a regra compartilhada e não inclui o intent nem a implementação dos hooks da #5.
- [ ] O intent e o changelog registram o resultado; `npm run check:context`, os testes pertinentes e o gate passam.
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

Preenchidos no Learn desta issue.

## Status

- **Criado**: 2026-09-25 (Fase: Intent), do plano aprovado na issue #17 (#17)
- **Status**: In Progress
- **Atualizado**: 2026-09-25 (Fase: Intent), branch cortada de `origin/main` após o Approve do dono (#17)
