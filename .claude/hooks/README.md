# Hooks do Claude Code (#5)

Hooks de projeto que interrompem, antes da ação, os atalhos do loop issue-first: o Approve escrito pelo agente, uma label de estado fora da única troca permitida, código editado sem o gate aberto, PR sem issue, merge com a revisão velha. O plano e os critérios estão em `context/intent/feature-claude-code-hooks.md`.

| Script                | Evento                                                                           | O que faz                                                                              |
| --------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `guard-bash.mjs`      | PreToolUse `Bash\|Monitor\|mcp__terminal__run_in_terminal`                       | Nega ou pede confirmação para comandos `gh` e `git` que contornam o loop               |
| `build-guard.mjs`     | PreToolUse `Edit\|Write\|NotebookEdit`                                           | Só deixa escrever fora de `context/intent/` com o gate aberto para a branch            |
| `plan-to-issue.mjs`   | PostToolUse `ExitPlanMode`, `Bash`, `Monitor` e `mcp__terminal__run_in_terminal` | Marca o plano aceito como pendente até ele ser publicado numa issue                    |
| `session-context.mjs` | SessionStart e UserPromptSubmit                                                  | Diz a branch, a issue e o estado do gate, e lembra que aprovação no chat não é Approve |

`lib/` guarda o que os quatro compartilham. `lib/edit-gate.mjs` é a decisão do gate para uma escrita no worktree: o `build-guard` a pede para o arquivo que o Edit ou o Write escreve, e o `guard-bash` (por `lib/git-rules.mjs`) para os arquivos que um comando `git` escreve (`git checkout -- arquivo`, `git restore`, `git merge`…). `lib/plan-publication.mjs` é o trabalho do `plan-to-issue`, carregado dentro de um `try`: se uma biblioteca não carrega, ou se marcar um plano aceito falha por qualquer motivo (o prazo acabou lendo o repositório, o diretório do git não aceita escrita, um defeito), o hook grava o marcador por um caminho curto, numa fatia do prazo guardada para isso; se nem assim consegue, remove o cache do gate de cada worktree do repositório, e o `build-guard` lê o gate como não rodado. Numa publicação, uma falha nunca remove o marcador. Em todos esses casos, o hook diz ao Claude pelo stderr, com saída 2, o que fez, ou que nada foi gravado e que não se constrói. Os contratos do loop vêm de `scripts/loop-sections.mjs`, a mesma fonte do gate e da auditoria. Os testes ficam em `test/hooks/`, e cada um roda o hook como processo, com a entrada em JSON no stdin.

Os hooks só restringem: nunca devolvem `allow`. Na dúvida, pedem confirmação (`ask`), e em `bypassPermissions`, `dontAsk` ou `auto` o `ask` crítico vira `deny`.

Cada execução tem um prazo só (`lib/budget.mjs`), dividido por todos os `git` e `gh` que ela roda e bem abaixo do `timeout` do hook no `settings.json`: passado o prazo, o hook pede confirmação, crítica, antes que o Claude Code o mate e deixe a ação passar sem decisão. `LOOP_HOOKS_BUDGET_MS` só baixa o prazo, para os testes.

As leituras ao vivo do GitHub vão ao host para onde o comando vai, nunca ao `GH_HOST` que o hook herdou: este projeto fica no github.com, e cada leitura leva `--hostname github.com`, com `GH_HOST` fixado e sem `GH_REPO`. Um comando cujo host não se lê (uma expansão em `GH_HOST` ou `--hostname`) não é lido em lugar nenhum: a regra pede confirmação, crítica.
