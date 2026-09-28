# Pattern: Ciclo de vida de issue e branch

## Resumo

Uma issue, uma branch, uma PR que fecha só essa issue, mergeada por merge commit, com o intent no primeiro commit e o Learn na mesma branch. Uma mudança grande vem numa stack: uma sub-issue por fatia, cada uma com a sua branch e a sua PR.

## Problema

- Antes do loop, os nove commits deste repositório entraram direto em `main`, sem issue e sem PR, e um deles (`5cc5e09`) fez mais do que a mensagem dizia. Trabalho sem issue não tem plano nem critério de aceite combinado, e ninguém consegue dizer depois o que era intenção e o que era acidente.
- Uma PR empilhada sobre outra esconde o que cada mudança faz. No lite-campaign, uma branch empilhada passou pelo gate, que ainda leu o primeiro commit da branch de baixo como se fosse o intent da de cima (brunohab/lite-campaign#122).
- Uma branch cortada de um `main` local, ou de uma branch `claude/*` de worktree, carrega trabalho não publicado para dentro de uma PR que não o descreve.

## Solução

### Antes do primeiro commit

- Toda mudança começa numa issue de `geazioliveira/marketo-sandbox`, com plano e critérios de aceite, e só anda depois do Approve do dono ([o gate do loop](loop-gate.md) confere).
- Uma issue, uma branch, com um destes dois formatos:
  - `feature/<número>-<slug>`, o formato padrão;
  - `fix/<número>-<slug>`, só para issue com a label `bug`. O gate recusa `fix/` numa issue sem ela (o mapa `branchCategory` de `scripts/loop-sections.mjs`).

  O número é o da issue, sem zero à esquerda. O slug usa letras minúsculas, dígitos e hífens simples. `claude/*`, `batch/` e qualquer outro nome são recusados: não existe lane sem issue.
- A branch é cortada do `origin/main` recém-buscado:

  ```sh
  git fetch origin && git switch -c <branch> origin/main
  git branch --unset-upstream
  ```

  Nunca de uma branch `claude/*` de worktree, de um `main` local nem de outra branch de issue, a não ser a fatia logo abaixo numa stack ([Numa stack](#numa-stack)). Os worktrees do Claude Code são cortados do HEAD do checkout principal, que pode carregar trabalho não publicado. No terminal, o passo `stacked` do gate recusa uma branch que compartilha esse tipo de história já logo depois do corte, antes do primeiro commit, mesmo que a branch de origem ande depois. A exceção: quando todo commit não publicado que veio junto cita `#N` desta issue e a ref de origem não é outra branch da #N, o `stacked` deixa passar, e quem julga esses commits é o `intent-first` no CI. Outra branch da mesma issue que compartilhe essa história nunca passa, porque uma issue tem uma branch só: só esta branch e a cópia dela em `origin` ficam de fora, e uma ref de mesmo nome em outro remote não. Se o HEAD já contém a outra branch, apague-a: a cópia local com `git branch -d` e a publicada com `git push origin --delete` (ou com `git fetch --prune origin` quando ela já não existe no GitHub), e a mensagem do gate cita só os comandos das cópias que ele achou; se ela tem commits que o HEAD não tem, junte o trabalho numa branch só antes de apagar a outra, nunca com `git branch -D`. No CI só existem as refs publicadas, então lá quem pega uma branch cortada de um `claude/*` não publicado ou de um `main` local é o `intent-first`, fora de draft. Um merge que trouxe outra branch o `stacked` vê no histórico, no terminal e no CI ([o gate do loop](loop-gate.md#o-passo-stacked)).
- O `git switch -c <branch> origin/main` deixa a branch com upstream em `origin/main`. Remova esse upstream (segunda linha acima), para que um `git push` ou um `git pull` nunca mire `main`. O primeiro push é `git push -u origin <branch>`.

### Durante o Build

- O primeiro commit toca só `context/intent/`: o intent vem antes do código (passo `intent-first`).
- Toda mensagem de commit termina com `Refs #N` (passo `commits-cite-issue`).
- A única branch que entra por merge é o `origin/main` e, numa stack, a fatia de baixo. Um merge de qualquer outra, até da cópia publicada da própria branch, faz o `stacked` dar não; para trazer a cópia publicada, use `git pull --ff-only` ou `git pull --rebase`. Antes do commit de intent, só vale um merge limpo do `origin/main`, sem nada acrescentado (passo `intent-first`).
- Rode `npm run gate` antes de começar e de novo antes da PR.
- Se o Build descobre algo que muda o plano, pare: um novo comentário cuja primeira linha é exatamente `# Plano`, com o plano inteiro, cancela o Approve. O dono aprova de novo e, depois do novo Approve, remove `ready-for-agent` e a aplica de novo, porque o gate só aceita a label aplicada depois do Approve em vigor.
- Trabalhe só no seu próprio worktree. O checkout principal pode guardar trabalho do dono sem commit.

### Learn e PR

- A PR abre em draft (`gh pr create --draft`), e logo depois o agente liga nela o monitor de CI do app, com auto-fix e comentários.
- O Learn é commitado na mesma branch antes de a PR sair de draft: o intent ganha Resultados e o status final, o changelog ganha a entrada da issue, e decisões e patterns novos entram (passo `learn`). Só então a PR sai de draft (`gh pr ready`), o que pede a revisão do Copilot.
- A primeira linha do corpo da PR é `Closes #N.`, e a PR fecha só essa issue.
- Nem o título da PR, nem o corpo dela, nem mensagem de commit nenhuma levam, escritos literalmente, `[skip ci]`, `[ci skip]`, `[no ci]`, `[skip actions]` ou `[actions skip]` (`skipCiTokens`), nem o trailer `skip-checks: true` (`skipChecksTrailer`). A mensagem do merge commit é o título e o corpo da PR, e com um desses tokens o push do merge não dispara nem o `Qualidade / check` nem a auditoria de `main`; na mensagem do commit da head, a PR fica sem o `Qualidade / check` ([fluxo](../../../docs/development/workflow.md#pull-requests-e-merge)).
- Fora de uma stack declarada, PRs não são empilhadas. Trabalho que depende de outro espera o merge dele e corta a branch do `origin/main` que já o contém.

### Numa stack

Uma mudança grande demais para uma PR vem numa stack de PRs pequenas, uma sobre a outra, cada uma com revisão e merge próprios (#31).

- **A declaração.** O plano vigente da issue mãe tem uma seção `## Stack` com a lista numerada das branches das fatias, de baixo para cima, cada item começando com a branch num code span. Bullets e parágrafos na seção são prosa. Cada fatia é uma sub-issue da mãe (`gh issue create --parent <mãe>`), com a label de categoria e `stack-slice`, sem label de estado. A mãe leva a label de categoria e a de estado, como toda issue, e nunca `stack-slice`: uma stack não se aninha. Como a branch leva o número da sub-issue, as sub-issues nascem antes do plano da mãe, que as cita. O gate recusa uma `Stack` que cite a branch de uma issue que não é fatia da mãe.
- **O Approve é o da mãe.** O gate julga a fatia pela mãe: o estado, as seções, os critérios e o Approve, e a branch na `Stack` do plano vigente. Toda revogação na mãe (um `# Plano` novo, uma edição, uma reabertura, o Approve retirado) vale para todas as fatias.
- **As branches.** A primeira fatia é cortada do `origin/main`, e cada outra, da fatia logo abaixo (`git switch -c <branch> origin/<de baixo>` e `git branch --unset-upstream`). Uma fatia cortada de uma fatia mais abaixo faz o `stacked` da fatia logo abaixo dela bloquear, até trazê-la com um merge. O intent vai no primeiro commit da primeira fatia, e o Learn, com a entrada do changelog citando a mãe, na última. Nas fatias do meio, o `intent-first` e o `learn` só relatam. Todo commit de uma fatia cita a sub-issue dela, e acima da primeira fatia isso bloqueia no CI.
- **As PRs.** Cada uma fecha só a sua sub-issue (`Closes #<sub>.`). A de cima abre com base na fatia de baixo (`gh pr create --draft --base <de baixo>`) e fica em draft até a de baixo ser mergeada: uma PR em draft não se mergeia, então nenhuma fatia é mergeada dentro de outra. A revisão do Copilot de uma fatia em draft é pedida à mão (`gh pr edit <n> --add-reviewer @copilot`).
- **Atualizar uma fatia.** Uma correção numa fatia de baixo sobe por merge, com `git merge origin/<de baixo>` na fatia de cima, nunca por rebase nem force-push. O `stacked` aceita esse merge.
- **O merge.** De baixo para cima, cada uma com as condições de sempre (abaixo). Uma fatia acima da primeira só passa com base `main` depois de toda fatia de baixo mergeada. Quando a branch de baixo é apagada no merge, o GitHub aponta a PR de cima para `main`; se não apontar, `gh pr edit <n> --base main`. Então ela sai de draft (`gh pr ready`). Depois do merge da última fatia, a mãe recebe um comentário com as PRs e os SHAs dos merges, e o dono a fecha.

### Merge

- Só com uma revisão do Copilot na cabeça da PR e nenhuma thread de revisão aberta, de qualquer autor, inclusive as desatualizadas ([ADR 0003](../../decisions/0003-copilot-review-and-no-open-threads-before-merge.md)). Um push depois da revisão pede outra: depois de cada push, se a timeline da PR (`gh api repos/geazioliveira/marketo-sandbox/issues/<n>/timeline`) não mostra um `review_requested` do Copilot depois da hora do push e nenhuma revisão dele chega na cabeça nova em uns 10 min, o agente pede de novo com `gh pr edit <n> --add-reviewer @copilot`. Uma revisão do Copilot que falhou não conta. Cada thread é respondida (o SHA da correção, uma issue `#N` ou a evidência) antes de ser resolvida, e, como resolver não dispara nada, o check é atualizado depois com `gh workflow run issue-link-refresh.yml --ref main -f pr=<n>`, que sozinho não é veredito fresco ([fluxo](../../../docs/development/workflow.md#a-revisão-do-copilot-e-as-threads)).
- Logo antes do merge, um veredito fresco, de um destes dois jeitos: o gate em modo CI na head da PR (`node scripts/gate.mjs --pr <n> --branch <branch>`), com saída 0, ou o `issue-link` da PR re-rodado (`gh run rerun <run-id>`) e acompanhado até o fim (`gh run watch <run-id> --exit-status`), também com saída 0. Os eventos da issue e as revisões só re-executam o `issue-link` pelo refresh, que ainda não foi provado ao vivo e não cobre todos os casos, e resolver uma thread não dispara nada, então um verde pode estar velho. Um disparo do refresh sozinho não é veredito fresco: o comando volta antes de o refresh rodar ([fluxo](../../../docs/development/workflow.md#pull-requests-e-merge)).
- Merge por merge commit (`gh pr merge --merge`). Squash e rebase estão desligados no repositório.
- A branch remota é apagada no merge, por configuração do repositório. Apague também a branch local e o worktree.
- A issue fecha sozinha pelo `Closes #N.`. Depois do merge, comente na issue: `Fechada pela PR #P no merge <sha>.`
- Este é o único caminho para `main`. Um push direto, um commit pelo editor web, um force-push ou outra reescrita do histórico de `main`, o merge de uma PR que não fecha issue, o de uma PR sem os checks exigidos verdes na head ou, desde `reviewRuleSince`, o de uma PR sem a revisão do Copilot na cabeça ou com thread aberta vira, depois do fato, uma issue `bug` + `needs-triage` da auditoria de `main`, e o dono decide registrar retroativamente ou reverter. A auditoria julga todo push em `main` que dispara run, e o que um push sem run trouxe entra na auditoria seguinte; o que ela não vê está no [fluxo](../../../docs/development/workflow.md#auditoria-de-main).

## Quando usar

- Toda mudança no repositório: código, testes, docs, configuração e contexto, inclusive um erro de digitação.

## Quando NÃO usar

- A issue de acompanhamento (#1) não tem branch nem PR. Cada sub-issue dela tem a própria branch.
- Um experimento local descartável, que nunca vira commit publicado. Se for para ficar, ele vira uma issue antes de virar uma branch.

## Decisões relacionadas

- [0001: Context Mesh no repositório e loop issue-first](../../decisions/0001-context-mesh-in-the-repository.md)
- [0002: Enforcement soft do loop no GitHub Free](../../decisions/0002-soft-enforcement-on-github-free.md)
- [0003: Revisão do Copilot na cabeça e nenhuma thread aberta antes do merge](../../decisions/0003-copilot-review-and-no-open-threads-before-merge.md)

## Status

- **Criado**: 2026-09-24 (Fase: Build), do plano aprovado na #2 e do pattern equivalente do lite-campaign (#2)
- **Status**: Active
- **Atualizado**: 2026-09-25 (Fase: Build), a PR passou a abrir em draft, com o monitor de CI do app ligado, e a sair de draft só com o Learn commitado; o merge passou a exigir uma revisão do Copilot na cabeça, que não falhou, e nenhuma thread de revisão aberta, com cada thread respondida antes de resolvida; a revisão passou a ser pedida de novo quando a timeline da PR não mostra o pedido depois de um push; e o veredito fresco passou a ser só o gate em modo CI na head da PR ou o rerun do `issue-link` acompanhado até o fim, nunca um disparo do refresh sozinho (#13)
- **Atualizado**: 2026-09-27 (Fase: Build), uma mudança grande pode vir numa stack, com uma sub-issue por fatia, a branch cortada da fatia de baixo e a PR em draft até ela mergear (#31)
