# Feature: Hooks do Claude Code para o loop issue-first

## Declaração de intenção

O gate e o CI apontam um desvio do loop depois que ele acontece. O contorno mais provável é o do próprio agente, que usa a mesma conta GitHub do dono: escrever o próprio Approve, aplicar `ready-for-agent`, editar código sem o gate aberto, abrir PR sem issue, mergear com a revisão velha. Esta feature traz hooks de projeto do Claude Code que interrompem esses atalhos **antes** da ação, em toda sessão aberta neste repositório.

Ao publicar um plano completo numa issue em `needs-triage`, o agente a troca por `ready-for-human`. Essa é a única escrita de label de estado que os hooks deixam passar; o Approve e `ready-for-agent` continuam só do dono.

## Critérios de aceite

Os mesmos do plano vigente, o `# Plano` de 2026-09-26 na #5.

- [x] `.claude/hooks/guard-bash.mjs` (PreToolUse `Bash|Monitor|mcp__terminal__run_in_terminal`) importa os contratos de `scripts/loop-sections.mjs`. Ele classifica com `commentOpening` a primeira linha não vazia de todo corpo de comentário, novo ou editado: `--body`, `--body-file`, `gh api …/comments`, GraphQL `addComment`, `updateIssueComment` e `PATCH` de comentário.
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
- [x] `.claude/hooks/build-guard.mjs` (Edit|Write|NotebookEdit) libera escrita no repositório fora de `context/intent/**` só com o cache do gate aberto para a branch atual. Em `main`, nega. Com plano pendente, pede `ask`.
- [x] `.claude/hooks/plan-to-issue.mjs`:
  - no PostToolUse de `ExitPlanMode`, grava `loop-plan-pending-<sessão>.json` no git dir do worktree e injeta os headings obrigatórios;
  - enquanto o marcador existir, `gateStatus()` devolve `pending-plan`, mesmo que o gate rode depois. O contrato, o `.d.mts` e o teste mudam juntos;
  - o marcador só é limpo por um `gh issue comment` ou `gh issue create` que publique o plano;
  - o `ExitPlanMode` **não** é bloqueado.
- [x] `.claude/hooks/session-context.mjs`:
  - no SessionStart, informa a branch, a issue, o estado do cache e o `ownerRule`;
  - no UserPromptSubmit, lembra que aprovação no chat não é Approve.
- [x] `permissions` do `.claude/settings.json`:
  - `deny`: `mcp__ccd_pr__set_auto_merge`, `Bash(gh pr merge *--admin*)`, `Edit(//**/.claude/settings.local.json)`, `Edit(//**/loop-gate.json)` e `Edit(//**/loop-plan-pending-*.json)`;
  - `ask`: os MCPs de browser e de computer-use.
- [x] Postura dos hooks:
  - só restringem e nunca devolvem `allow`;
  - com `permission_mode` em `bypassPermissions`, `dontAsk` ou `auto`, os `ask` críticos viram `deny`: merge, caminhos do harness, cache não verificado, plano pendente e tripwire;
  - um wrapper em shell sai com 2 se o script estiver ausente;
  - o git é resolvido pelo worktree do alvo (o `cwd`), nunca por `${CLAUDE_PROJECT_DIR}`;
  - uma leitura do GitHub que falha ou demora vira `ask`, nunca passa em silêncio.
- [x] `test/hooks/*.spec.ts` passa, com um caso por regra. Cobre a exceção de label, a permitida e as recusas vizinhas:
  - `ready-for-agent`;
  - outra label no mesmo comando;
  - a issue fora de `needs-triage`;
  - sem `# Plano`.

  Cobre também falsos positivos comuns que **não** podem ser negados: `gh issue view`, `grep "Owner Approve"` e `git log`.
- [x] O `lint` passa a cobrir `.claude/hooks/`. O bloco de drift que exige o futuro para os hooks é trocado por um que confere as docs no presente.
- [x] O `.claude/settings.json` entra como último commit. Depois de reiniciar a sessão, e de confiar no workspace se isso for pedido, duas sondas inofensivas são negadas:
  - `gh issue edit 1 --remove-label needs-info`;
  - um `Edit` em `src/` numa sonda `claude/x` cortada de `origin/main`, apagada logo depois.
- [x] A ADR 0002 lista os limites que continuam: o dono pode contornar; `--no-verify`; ferramentas fora do Claude Code; sessões de outros projetos sem hooks. O fluxo, o `AGENTS.md` e os textos que falavam dos hooks no futuro passam a descrevê-los como estão.
- [x] A PR desta issue marca, citando a evidência, o critério da #17 que manda reconciliar esta branch com `main` (o comentário de 2026-09-26 na #17).
- [x] `npm run check`, o e2e e o gate passam, e a PR segue a ADR 0003.

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

O que foi construído está na [entrada do changelog](../evolution/changelog.md): os quatro hooks em `.claude/hooks/`, a biblioteca em `.claude/hooks/lib/`, o `run.sh`, o `.claude/settings.json` e 1.213 testes em `test/hooks/`.

Como foi verificado:

- **Revisão adversarial por peça,** com teste de mutação: cada regra tem um teste que falha quando ela é alterada.
- **Corpus de comandos reais** ([pattern](../knowledge/patterns/real-command-corpus.md)): 902 comandos Bash das sessões deste projeto.
  - A primeira rodada deu 816 que passam, 75 que pedem confirmação e 11 recusas. Depois das correções, 847, 44 e 11.
  - As 11 recusas são as mesmas, e todas certas: merges de PRs já mergeadas, trocas de label em issues que mudaram de estado, um `gh label create` de label de estado e um `PATCH` nas configurações do repositório.
  - A mediana ficou em 93 ms, e o máximo, em 1,5 s.
- **A revisão do Copilot na PR #26** achou seis brechas: um remote mudado antes do `gh` na mesma linha, a PR criada pela API sem corpo, um `-R` ilegível tratado como este projeto, a mensagem do `git merge`, a publicação feita de outro worktree e o cache do gate dos outros worktrees. Cada uma foi fechada com um teste que falha sem a correção, e uma verificação independente reverteu cada correção, em 19 mutações, todas pegas. O corpus não mudou nenhuma decisão.
- **A segunda revisão do Copilot** achou mais seis: um programa numa variável que o hook não lê, o `gh pr create --web`, as mensagens que um commit traz de outro (`cherry-pick`, `revert`, `am`, `commit -C`), a falta de um prazo por execução, os nomes protegidos no clone de outro projeto e o `plan-to-issue` depois do `Monitor` e do terminal. Foram 62 mutações; as 17 que nenhum teste pegava ganharam teste, e um deles achou a brecha do `core.useReplaceRefs`, corrigida. O corpus passou a pedir confirmação numa linha a mais, das 902.
- **As sondas,** com os hooks ligados nesta sessão, em modo `auto`:
  - `gh issue edit 1 --remove-label needs-info` foi negado pelo `guard-bash`;
  - um `Edit` em `src/main.ts` numa sonda `claude/x` cortada de `origin/main` foi negado pelo `build-guard` ("o gate ainda não rodou neste worktree");
  - a sonda foi apagada em seguida.

Desvios do plano e achados:

- **Os hooks valeram sem reiniciar.** O Claude Code carregou o `.claude/settings.json` assim que ele foi escrito, e as sondas rodaram na mesma sessão.
  - O primeiro efeito foi o `guard-bash` negar um comando de simulação que rodava um `sh` e citava `needs-info`, como a tripwire manda.
  - O segundo foi negar um script Python do próprio Learn, porque o texto que ele escrevia citava comandos `gh`: a prosa que cita um comando conta como poder rodá-lo. A edição foi feita com a ferramenta Edit.
- **O marcador do plano pendente fica no diretório git comum,** um por repositório, e não no do worktree. Assim os três hooks o gravam, leem e limpam no mesmo lugar, mesmo quando a sessão muda de worktree.
- **Ao publicar o plano, o `plan-to-issue` apaga também o cache do gate de cada worktree do repositório.** Um `# Plano` cancela o Approve, e sem isso o `build-guard` seguiria lendo o cache aberto de antes, neste worktree ou em outro.
- **O `guard-bash` foi além da lista do plano,** sempre para o lado que restringe:
  - lê as variáveis atribuídas na própria linha, o que corta falsos positivos e também pega uma label de estado guardada numa variável;
  - resolve aliases do `git` e do `gh`, segue a HEAD que um comando anterior da linha mudou e julga um push pelo repositório de destino;
  - nega mexer nos arquivos do loop pelo shell, pelo nome, por um padrão ou pelo diretório que os guarda ([anti-pattern](../knowledge/anti-patterns/guard-by-literal-name.md)), e pede confirmação para uma escrita pelo shell num caminho do harness;
  - nega criar, editar ou apagar uma label de estado e um `PATCH` nas configurações do repositório, como já negava `gh repo edit`;
  - a tripwire só dispara quando o programa pode rodar processos ou acessar a rede, ou quando cita um arquivo do loop.
- **O `build-guard` nega um cache não verificado com `open: false`,** em vez de pedir confirmação: é o lado que restringe.
- **Uma tag chamada `main`** fazia o `git symbolic-ref --short` devolver `heads/main`, e o `build-guard` deixava editar em `main`. Agora a branch sai do ref inteiro.
- **O `lint`, o `format` e o `format:check`** passaram a cobrir `.claude/hooks/`. O `check-context.spec` ganhou um tempo limite de 60 s, porque os specs dos hooks, que abrem muitos processos, rodam ao lado dele.
- **Um agente da verificação rodou por engano linhas de uma lista de casos**, escrita num heredoc que tinha um `EOF` dentro dela. Tudo falhou antes de chegar ao projeto, e o GitHub confirmou que a #5 e as labels não mudaram.

Para o dono:

- **Em `auto`, as confirmações críticas viram negação,** como você decidiu no Approve de 2026-09-25: o `gh pr merge`, uma escrita num caminho do harness, um plano pendente e a tripwire. O merge desta PR, e de qualquer outra, é feito fora do modo `auto`, por você ou numa sessão em outro modo.
- **Os limites** estão na [ADR 0002](../decisions/0002-soft-enforcement-on-github-free.md). Passam:
  - um programa rodado a partir de um arquivo;
  - um nome montado em tempo de execução;
  - um clone sem `origin`;
  - uma sessão nova, que não herda o marcador da anterior.

## Status

- **Criado**: 2026-09-25 (Fase: Intent), do plano aprovado na issue #5 (#5)
- **Status**: Completed
- **Atualizado**: 2026-09-26 (Fase: Learn), os hooks existem, ligados pelo `.claude/settings.json`, e as duas sondas foram negadas com eles ativos (#5)
- **Atualizado**: 2026-09-26 (Fase: Learn), as seis brechas da revisão do Copilot na PR #26 foram fechadas (#5)
- **Atualizado**: 2026-09-27 (Fase: Learn), as seis brechas da segunda revisão do Copilot na PR #26 foram fechadas (#5)
