# Feature: Hooks do Claude Code para o loop issue-first

## Declaração de intenção

O gate e o CI apontam um desvio do loop depois que ele acontece. O contorno mais provável é o do próprio agente, que usa a mesma conta GitHub do dono. Ele pode:

- escrever o próprio Approve;
- aplicar `ready-for-agent`;
- editar código sem o gate aberto;
- abrir PR sem issue;
- mergear com a revisão velha.

Esta feature traz hooks de projeto do Claude Code que interrompem esses atalhos **antes** da ação, em toda sessão aberta neste repositório.

Ao publicar um plano completo numa issue em `needs-triage`, o agente a troca por `ready-for-human`. Essa é a única escrita de label de estado que os hooks deixam passar. O Approve e `ready-for-agent` continuam só do dono.

A feature entra numa stack de 8 PRs, uma por módulo (#31). A PR #26, com a feature inteira, passou por dez revisões do Copilot, e o dono a fechou em 2026-09-27.

## Critérios de aceite

Os mesmos do plano vigente, o `# Plano` de 2026-09-28 na #5.

- [ ] `.claude/hooks/guard-bash.mjs` (PreToolUse `Bash|Monitor|mcp__terminal__run_in_terminal`) importa os contratos de `scripts/loop-sections.mjs`. Ele classifica com `commentOpening` a primeira linha não vazia de todo corpo de comentário, novo ou editado: `--body`, `--body-file`, `gh api …/comments`, GraphQL `addComment`, `updateIssueComment` e `PATCH` de comentário.
  - **Nega**:
    - um corpo que abre como Approve, retirada ou título quase-Approve;
    - `ready-for-agent`, por qualquer via, sempre;
    - qualquer outra escrita de label de estado, por qualquer via, com uma única exceção. A exceção é a troca `agentPlanLabelTransition`: remover `needs-triage` e adicionar `ready-for-human` num mesmo `gh issue edit`, sem nenhuma outra label no comando. Ela só vale quando a issue está em `needs-triage` e o último comentário dela abre com `# Plano`. Se o hook não conseguir confirmar esse estado, pede `ask`;
    - label de estado fora de `agentCreateStateLabels` em `gh issue create`;
    - `gh pr create` sem `Closes #N.` na primeira linha, ou fora de uma branch válida (`parseBranch`);
    - `git commit` e `git push` em `main`;
    - `gh issue reopen` e `gh repo edit`;
    - qualquer um dos `skipCiTokens`, ou o `skipChecksTrailer`, em mensagem de commit, título ou corpo de PR;
    - `resolveReviewThread` numa thread cujo último comentário não é de quem resolve.
  - **Pede `ask`**:
    - `gh pr merge`, só quando os `requiredChecks` estão verdes na cabeça e, lidos ao vivo, há revisão do Copilot na cabeça, nenhum pedido pendente e zero threads abertas. Senão, nega;
    - `gh issue edit --body*`;
    - `PATCH` de comentário e `updateIssueComment`, com qualquer corpo;
    - uma tripwire de texto cru para indireções (`node -e`, `python -c`, aliases) que citem label de estado, o Approve ou o cache.
- [ ] `.claude/hooks/build-guard.mjs` (Edit|Write|NotebookEdit) libera escrita no repositório fora de `context/intent/**` só com o cache do gate aberto para a branch atual. Em `main`, nega. Com plano pendente, pede `ask`.
- [ ] `.claude/hooks/plan-to-issue.mjs`:
  - no PostToolUse de `ExitPlanMode`, grava `loop-plan-pending-<sessão>.json` no diretório git comum do repositório, visível de todo worktree, e injeta os headings obrigatórios;
  - enquanto o marcador existir, `gateStatus()` devolve `pending-plan`, mesmo que o gate rode depois. O contrato, o `.d.mts` e o teste mudam juntos;
  - o marcador só é limpo por um `gh issue comment` ou `gh issue create` que publique o plano;
  - o `ExitPlanMode` **não** é bloqueado.
- [ ] `.claude/hooks/session-context.mjs`:
  - no SessionStart, informa a branch, a issue, o estado do cache e o `ownerRule`;
  - no UserPromptSubmit, lembra que aprovação no chat não é Approve.
- [ ] `permissions` do `.claude/settings.json`:
  - `deny`: `mcp__ccd_pr__set_auto_merge`, `Bash(gh pr merge *--admin*)`, `Edit(//**/.claude/settings.local.json)`, `Edit(//**/loop-gate.json)` e `Edit(//**/loop-plan-pending-*.json)`;
  - `ask`: os MCPs de browser e de computer-use.
- [ ] Postura dos hooks:
  - só restringem e nunca devolvem `allow`;
  - com `permission_mode` em `bypassPermissions`, `dontAsk` ou `auto`, os `ask` críticos viram `deny`;
  - um wrapper em shell sai com 2 se o script estiver ausente;
  - o git é resolvido pelo worktree do alvo (o `cwd`), nunca por `${CLAUDE_PROJECT_DIR}`;
  - uma leitura do GitHub que falha ou demora vira `ask`, nunca passa em silêncio.
- [ ] `test/hooks/*.spec.ts` passa, com um caso por regra, a exceção de label e as recusas vizinhas dela, e os falsos positivos comuns que **não** podem ser negados (`gh issue view`, `grep "Owner Approve"` e `git log`).
- [ ] O `lint` cobre `.claude/hooks/`. O bloco de drift que exige o futuro para os hooks é trocado por um que confere as docs no presente.
- [ ] Cada fatia da `Stack` tem PR própria, que fecha só a sua sub-issue, e as fatias são mergeadas de baixo para cima, cada uma com a revisão do Copilot na cabeça e zero threads abertas (ADR 0003).
- [ ] Os hooks ficam inertes até a última fatia: nenhuma fatia antes da 8 registra hook no `.claude/settings.json`.
- [ ] Os achados das revisões seguem o critério do agente cooperativo, e cada limite novo fica na ADR 0002, citado na resposta da thread.
- [ ] O `.claude/settings.json` entra na última fatia. Depois de reiniciar a sessão, e de confiar no workspace se isso for pedido, duas sondas inofensivas são negadas:
  - `gh issue edit 1 --remove-label needs-info`;
  - um `Edit` em `src/` numa sonda `claude/x` cortada de `origin/main`, apagada logo depois.
- [ ] A ADR 0002 lista os limites que continuam:
  - o dono pode contornar;
  - `--no-verify`;
  - ferramentas fora do Claude Code;
  - sessões de outros projetos sem hooks;
  - os limites do critério do agente cooperativo, os dois da décima revisão da PR #26 inclusive.

  O fluxo, o `AGENTS.md` e os textos que falavam dos hooks no futuro passam a descrevê-los como estão.
- [ ] A PR da última fatia marca, citando a evidência, o critério da #17 que manda reconciliar esta issue com `main` (o comentário de 2026-09-26 na #17).
- [ ] Em cada fatia, `npm run check`, o e2e e o gate passam, e a PR segue a ADR 0003.

## Abordagem técnica

O código vem da branch `feature/5-hooks-claude-code` (`9377db6`), que passou pelas dez revisões da PR #26. Ele é portado para o `main` de hoje sem ser reescrito, uma fatia por módulo, na ordem do grafo de imports:

1. `feature/34-hooks-base`: este intent, o contrato do plano pendente (`planPendingFile` e o `pendingPlan` do `gateStatus()`), `lib/io.mjs`, `lib/budget.mjs`, `lib/repo.mjs`, `run.sh`, o `lint` e o `format` cobrindo `.claude/hooks/` e o suporte de teste;
2. `feature/35-hooks-shell`: o parser de shell;
3. `feature/36-hooks-build-guard`: `lib/edit-gate.mjs` e `build-guard.mjs`;
4. `feature/37-hooks-git-rules`: as regras de git;
5. `feature/38-hooks-gh-rules`: as regras do `gh`;
6. `feature/39-hooks-guard-bash`: o `guard-bash`;
7. `feature/40-hooks-plan-to-issue`: `lib/plan-publication.mjs`, `plan-to-issue.mjs` e `session-context.mjs`;
8. `feature/41-hooks-settings`: as docs no presente, o README dos hooks inclusive, os limites na ADR 0002, o Learn e, por último, o `.claude/settings.json`, que liga os hooks, e as sondas.

Os comentários dos scripts falam dos hooks no futuro até a última fatia, como o bloco de drift exige, e passam ao presente com as docs. O README dos hooks, que o plano pôs na fatia 1, vai na 8 pelo mesmo motivo: ele descreve os quatro hooks como estão.

## Perguntas em aberto

Nenhuma. O Approve do dono na #5 (2026-09-28, "Pode seguir com suas recomendações") ficou com as quatro recomendações do plano revisado:

- o critério do agente cooperativo para os achados das revisões;
- as 8 fatias por módulo, na ordem da seção `Stack`;
- os dois achados da décima revisão da PR #26 como limites na ADR 0002;
- o código da `9377db6` portado sem ser reescrito.

As respostas dos Approves anteriores continuam valendo: os `ask` críticos viram `deny` em `auto`, e o hook de nível de usuário fica para uma issue própria.

## Decisões relacionadas

- [ADR 0001: Context Mesh no repositório e loop issue-first](../decisions/0001-context-mesh-in-the-repository.md)
- [ADR 0002: Enforcement soft do loop no GitHub Free](../decisions/0002-soft-enforcement-on-github-free.md)
- [ADR 0003: Revisão do Copilot na cabeça e nenhuma thread aberta antes do merge](../decisions/0003-copilot-review-and-no-open-threads-before-merge.md)

## Patterns relacionados

- [O gate do loop](../knowledge/patterns/loop-gate.md)
- [Ciclo de vida de issue e branch](../knowledge/patterns/issue-branch-lifecycle.md)
- [Revisão classificada por risco](../knowledge/patterns/risk-classified-review.md)
- [Uma PR que prende partes independentes](../knowledge/anti-patterns/one-pr-for-many-independent-parts.md)

## Status

- **Criado**: 2026-09-25 (Fase: Intent), do plano aprovado na issue #5 (#5)
- **Status**: In Progress
- **Atualizado**: 2026-09-28 (Fase: Intent), a #5 virou uma stack de 8 fatias (#34 a #41) com o plano revisado, depois de a PR #26 ser fechada (#5)
