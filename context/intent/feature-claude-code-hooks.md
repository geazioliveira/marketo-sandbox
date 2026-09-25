# Feature: Hooks do Claude Code para o loop issue-first

## Declaração de intenção

O gate e o CI registram desvios depois que acontecem. A issue #5 pede hooks de projeto que interrompam, antes da ação, atalhos do agente como escrever o próprio Approve, mover labels de estado, editar código sem o gate aberto e abrir PR sem issue. O dono continua sendo quem aprova o plano e muda o estado da issue.

## Critérios de aceite

- [ ] `guard-bash.mjs` protege comandos Git e GitHub que poderiam contornar o loop, usando os contratos de `scripts/loop-sections.mjs`.
- [ ] `build-guard.mjs` exige cache do gate aberto antes de editar fora de `context/intent/`, bloqueia escrita em `main` e considera plano pendente.
- [ ] `plan-to-issue.mjs` registra o plano aceito no `ExitPlanMode` e o mantém pendente até sua publicação numa issue.
- [ ] `session-context.mjs` informa branch, issue, gate e a divisão de responsabilidades entre agente e dono.
- [ ] `.claude/settings.json` registra os hooks e as permissões, como último commit de código da PR.
- [ ] Os hooks restringem ou pedem confirmação, nunca retornam `allow`; os modos sem pergunta tratam `ask` crítico como `deny`.
- [ ] Testes cobrem cada regra e os falsos positivos comuns; `npm run check`, e2e e gate passam.
- [ ] Depois de confiar no workspace e reiniciar uma sessão interativa do Claude Code, as duas sondas inofensivas da issue #5 são negadas.
- [ ] ADR 0002 e o fluxo documentam o uso, os limites e a saída de emergência do dono.

## Abordagem técnica

Uma biblioteca compartilhada em `.claude/hooks/lib/` concentra leitura de entrada, resolução do worktree, estado do gate e classificação de comandos. Cada ponto de entrada do hook usa essa biblioteca e tem testes com entrada e saída reais. `settings.json` só é adicionado depois de testar os scripts isoladamente, para não bloquear a própria construção.

## Perguntas em aberto

O dono respondeu no Approve da #5 que segue as recomendações: `ask` crítico vira `deny` em `auto`, e um hook de nível de usuário para outras sessões fica para uma issue própria.

## Decisões relacionadas

- [ADR 0001: Context Mesh no repositório e loop issue-first](../decisions/0001-context-mesh-in-the-repository.md)
- [ADR 0002: Enforcement soft do loop no GitHub Free](../decisions/0002-soft-enforcement-on-github-free.md)
- [ADR 0003: Revisão do Copilot na cabeça e nenhuma thread aberta antes do merge](../decisions/0003-copilot-review-and-no-open-threads-before-merge.md)

## Patterns relacionados

- [O gate do loop](../knowledge/patterns/loop-gate.md)
- [Ciclo de vida de issue e branch](../knowledge/patterns/issue-branch-lifecycle.md)

## Resultados

Preenchidos no Learn desta issue.

## Status

- **Criado**: 2026-09-25 (Fase: Intent), do plano aprovado na issue #5 (#5)
- **Status**: In Progress
- **Atualizado**: 2026-09-25 (Fase: Intent), branch aberta após o merge da #4 (#5)
