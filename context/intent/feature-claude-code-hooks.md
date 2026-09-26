# Feature: Hooks do Claude Code para o loop issue-first

## Declaração de intenção

O gate e o CI apontam um desvio do loop depois que ele acontece. O contorno mais provável é o do próprio agente, que usa a mesma conta GitHub do dono: escrever o próprio Approve, aplicar `ready-for-agent`, editar código sem o gate aberto, abrir PR sem issue, mergear com a revisão velha. Esta feature traz hooks de projeto do Claude Code que interrompem esses atalhos **antes** da ação, em toda sessão aberta neste repositório.

Ao publicar um plano completo numa issue em `needs-triage`, o agente a troca por `ready-for-human`. Essa é a única escrita de label de estado que os hooks deixam passar; o Approve e `ready-for-agent` continuam só do dono.

## Critérios de aceite

Os mesmos do plano vigente, o `# Plano` de 2026-09-26 na #5.

- [ ] `.claude/hooks/guard-bash.mjs` (PreToolUse `Bash|Monitor|mcp__terminal__run_in_terminal`) importa os contratos de `scripts/loop-sections.mjs`. Ele classifica com `commentOpening` a primeira linha não vazia de todo corpo de comentário, novo ou editado: `--body`, `--body-file`, `gh api …/comments`, GraphQL `addComment`, `updateIssueComment` e `PATCH` de comentário.
  - **Nega**:
    - um corpo que abre como Approve, retirada ou título quase-Approve;
    - `ready-for-agent`, por qualquer via, sempre;
    - qualquer outra escrita de label de estado, por qualquer via (`gh issue edit`, REST `…/labels`, GraphQL `add/removeLabelsToLabelable`), com uma única exceção. A exceção é a troca `agentPlanLabelTransition`: remover `needs-triage` e adicionar `ready-for-human` num mesmo `gh issue edit`, sem nenhuma outra label no comando. Ela só vale quando a issue está em `needs-triage` e o último comentário dela abre com `# Plano`. Se o hook não conseguir confirmar esse estado, pede `ask`;
    - label de estado fora de `agentCreateStateLabels` em `gh issue create`;
    - `gh pr create` sem `Closes #N.` na primeira linha, ou fora de uma branch válida (`parseBranch`);
    - `git commit` e `git push` em `main`;
    - `gh issue reopen` e `gh repo edit`;
    - qualquer um dos `skipCiTokens`, ou o `skipChecksTrailer`, em mensagem de commit, título ou corpo de PR;
    - `resolveReviewThread` numa thread cujo último comentário não é de quem resolve, ou seja, sem resposta antes de resolver.
  - **Pede `ask`**:
    - `gh pr merge`, só quando os `requiredChecks` estão verdes na cabeça e, lidos ao vivo por GraphQL, há revisão do Copilot na cabeça (`copilotReviewOn`), nenhum pedido pendente (`copilotRequested`) e zero threads abertas (`openThreads`). Senão, nega;
    - `gh issue edit --body*`;
    - `PATCH` de comentário e `updateIssueComment`, com qualquer corpo, porque editar um comentário depois do Approve o revoga;
    - uma tripwire de texto cru para indireções (`node -e`, `python -c`, aliases) que citem label de estado, o Approve ou o cache.
- [ ] `.claude/hooks/build-guard.mjs` (Edit|Write|NotebookEdit) libera escrita no repositório fora de `context/intent/**` só com o cache do gate aberto para a branch atual. Em `main`, nega. Com plano pendente, pede `ask`.
- [ ] `.claude/hooks/plan-to-issue.mjs`:
  - no PostToolUse de `ExitPlanMode`, grava `loop-plan-pending-<sessão>.json` no git dir do worktree e injeta os headings obrigatórios;
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
  - com `permission_mode` em `bypassPermissions`, `dontAsk` ou `auto`, os `ask` críticos viram `deny`: merge, caminhos do harness, cache não verificado, plano pendente e tripwire;
  - um wrapper em shell sai com 2 se o script estiver ausente;
  - o git é resolvido pelo worktree do alvo (o `cwd`), nunca por `${CLAUDE_PROJECT_DIR}`;
  - uma leitura do GitHub que falha ou demora vira `ask`, nunca passa em silêncio.
- [ ] `test/hooks/*.spec.ts` passa, com um caso por regra. Cobre a exceção de label, a permitida e as recusas vizinhas:
  - `ready-for-agent`;
  - outra label no mesmo comando;
  - a issue fora de `needs-triage`;
  - sem `# Plano`.

  Cobre também falsos positivos comuns que **não** podem ser negados: `gh issue view`, `grep "Owner Approve"` e `git log`.
- [ ] O `lint` passa a cobrir `.claude/hooks/`. O bloco de drift que exige o futuro para os hooks é trocado por um que confere as docs no presente.
- [ ] O `.claude/settings.json` entra como último commit. Depois de reiniciar a sessão, e de confiar no workspace se isso for pedido, duas sondas inofensivas são negadas:
  - `gh issue edit 1 --remove-label needs-info`;
  - um `Edit` em `src/` numa sonda `claude/x` cortada de `origin/main`, apagada logo depois.
- [ ] A ADR 0002 lista os limites que continuam: o dono pode contornar; `--no-verify`; ferramentas fora do Claude Code; sessões de outros projetos sem hooks. O fluxo, o `AGENTS.md` e os textos que falavam dos hooks no futuro passam a descrevê-los como estão.
- [ ] A PR desta issue marca, citando a evidência, o critério da #17 que manda reconciliar esta branch com `main` (o comentário de 2026-09-26 na #17).
- [ ] `npm run check`, o e2e e o gate passam, e a PR segue a ADR 0003.

## Abordagem técnica

- **Uma biblioteca e quatro pontos de entrada.** `.claude/hooks/lib/` concentra a leitura da entrada do hook, a resolução do worktree pelo `cwd`, o estado do gate, o parser de shell e as regras de `gh` e de `git`. Cada hook é um script pequeno que só compõe a biblioteca.
- **Os contratos vêm de `scripts/loop-sections.mjs`.** Os hooks importam dali o que o gate e a auditoria já usam, e o que falta entra ali, com o `.d.mts` e o teste.
- **Testes com processo real.** Cada hook roda como processo, com a entrada em JSON no stdin e a decisão lida no stdout, como o `gate.spec` faz com o gate. O `gh` é o dublê estrito que os specs já usam.
- **O `settings.json` por último.** Os scripts são testados isolados antes de serem ligados, para que um hook com defeito não trave a própria construção.

## Perguntas em aberto

Respondidas pelo dono no Approve de 2026-09-26 ("Pode seguir com suas recomendações"), as quatro com sim:

1. A exceção de label no formato estrito do plano.
2. O `gh pr merge` lendo ao vivo a revisão do Copilot, os pedidos pendentes e as threads.
3. O `resolveReviewThread` negado quando o último comentário da thread não é de quem resolve, o que vale para a conta, inclusive para o dono numa sessão do Claude Code.
4. O plano pendente fechando o cache até ser publicado.

As respostas do Approve de 2026-09-25 continuam: em `auto`, os `ask` críticos viram `deny`; o hook de nível de usuário fica para uma issue própria.

## Decisões relacionadas

- [ADR 0001: Context Mesh no repositório e loop issue-first](../decisions/0001-context-mesh-in-the-repository.md)
- [ADR 0002: Enforcement soft do loop no GitHub Free](../decisions/0002-soft-enforcement-on-github-free.md)
- [ADR 0003: Revisão do Copilot na cabeça e nenhuma thread aberta antes do merge](../decisions/0003-copilot-review-and-no-open-threads-before-merge.md)

## Patterns relacionados

- [O gate do loop](../knowledge/patterns/loop-gate.md)
- [Ciclo de vida de issue e branch](../knowledge/patterns/issue-branch-lifecycle.md)
- [Revisão classificada por risco](../knowledge/patterns/risk-classified-review.md)

## Resultados

Preenchidos no Learn desta issue.

## Status

- **Criado**: 2026-09-25 (Fase: Intent), do plano aprovado na issue #5 (#5)
- **Status**: In Progress
- **Atualizado**: 2026-09-26 (Fase: Build), os critérios passaram a ser os do `# Plano` revisado de 2026-09-26, aprovado pelo dono no mesmo dia (#5)
