# Pattern: Ciclo de vida de issue e branch

## Resumo

Uma issue, uma branch, uma PR que fecha só essa issue, mergeada por merge commit, com o intent no primeiro commit e o Learn na mesma branch.

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

  Nunca de uma branch `claude/*` de worktree, de um `main` local nem de outra branch de issue. Os worktrees do Claude Code são cortados do HEAD do checkout principal, que pode carregar trabalho não publicado. No terminal, o passo `stacked` do gate recusa uma branch que compartilha esse tipo de história já logo depois do corte, antes do primeiro commit, mesmo que a branch de origem ande depois. A exceção: quando todo commit não publicado que veio junto cita `#N` desta issue, o `stacked` deixa passar, e quem julga esses commits é o `intent-first` no CI. No CI só existem as refs publicadas, então lá quem pega uma branch cortada de um `claude/*` não publicado ou de um `main` local é o `intent-first`, fora de draft. Um merge que trouxe outra branch o `stacked` vê no histórico, no terminal e no CI ([o gate do loop](loop-gate.md#o-passo-stacked)).
- O `git switch -c <branch> origin/main` deixa a branch com upstream em `origin/main`. Remova esse upstream (segunda linha acima), para que um `git push` ou um `git pull` nunca mire `main`. O primeiro push é `git push -u origin <branch>`.

### Durante o Build

- O primeiro commit toca só `context/intent/`: o intent vem antes do código (passo `intent-first`).
- Toda mensagem de commit termina com `Refs #N` (passo `commits-cite-issue`).
- A única branch que entra por merge é o `origin/main`. Um merge de qualquer outra, até da cópia publicada da própria branch, faz o `stacked` dar não; para trazer a cópia publicada, use `git pull --ff-only` ou `git pull --rebase`. Antes do commit de intent, só vale um merge limpo do `origin/main`, sem nada acrescentado (passo `intent-first`).
- Rode `npm run gate` antes de começar e de novo antes da PR.
- Se o Build descobre algo que muda o plano, pare: um novo comentário cuja primeira linha é exatamente `# Plano`, com o plano inteiro, cancela o Approve. O dono aprova de novo e, depois do novo Approve, remove `ready-for-agent` e a aplica de novo, porque o gate só aceita a label aplicada depois do Approve em vigor.
- Trabalhe só no seu próprio worktree. O checkout principal pode guardar trabalho do dono sem commit.

### Learn e PR

- O Learn é commitado na mesma branch antes de a PR sair de draft: o intent ganha Resultados e o status final, o changelog ganha a entrada da issue, e decisões e patterns novos entram (passo `learn`).
- A primeira linha do corpo da PR é `Closes #N.`, e a PR fecha só essa issue.
- Nem o título da PR, nem o corpo dela, nem mensagem de commit nenhuma levam, escritos literalmente, `[skip ci]`, `[ci skip]`, `[no ci]`, `[skip actions]` ou `[actions skip]` (`skipCiTokens`), nem o trailer `skip-checks: true` (`skipChecksTrailer`). A mensagem do merge commit é o título e o corpo da PR, e com um desses tokens o push do merge não dispara nem o `Qualidade / check` nem a auditoria de `main`; na mensagem do commit da head, a PR fica sem o `Qualidade / check` ([fluxo](../../../docs/development/workflow.md#pull-requests-e-merge)).
- PRs nunca são empilhadas. Trabalho que depende de outro espera o merge dele e corta a branch do `origin/main` que já o contém.

### Merge

- Logo antes do merge, um veredito fresco: re-rode o `issue-link` da PR ou rode o gate em modo CI na head da PR, e exija saída 0. Os eventos da issue só re-executam o `issue-link` pelo refresh da #3, que ainda não foi provado ao vivo e não cobre todos os casos, então um verde pode estar velho ([fluxo](../../../docs/development/workflow.md#pull-requests-e-merge)).
- Merge por merge commit (`gh pr merge --merge`). Squash e rebase estão desligados no repositório.
- A branch remota é apagada no merge, por configuração do repositório. Apague também a branch local e o worktree.
- A issue fecha sozinha pelo `Closes #N.`. Depois do merge, comente na issue: `Fechada pela PR #P no merge <sha>.`
- Este é o único caminho para `main`. Um push direto, um commit pelo editor web, um force-push ou outra reescrita do histórico de `main`, o merge de uma PR que não fecha issue ou o de uma PR sem os checks exigidos verdes na head vira, depois do fato, uma issue `bug` + `needs-triage` da auditoria de `main`, e o dono decide registrar retroativamente ou reverter. A auditoria julga todo push em `main` que dispara run, e o que um push sem run trouxe entra na auditoria seguinte; o que ela não vê está no [fluxo](../../../docs/development/workflow.md#auditoria-de-main).

## Quando usar

- Toda mudança no repositório: código, testes, docs, configuração e contexto, inclusive um erro de digitação.

## Quando NÃO usar

- A issue de acompanhamento (#1) não tem branch nem PR. Cada fatia dela é uma sub-issue com a própria branch.
- Um experimento local descartável, que nunca vira commit publicado. Se for para ficar, ele vira uma issue antes de virar uma branch.

## Decisões relacionadas

- [0001: Context Mesh no repositório e loop issue-first](../../decisions/0001-context-mesh-in-the-repository.md)
- [0002: Enforcement soft do loop no GitHub Free](../../decisions/0002-soft-enforcement-on-github-free.md)

## Status

- **Criado**: 2026-09-24 (Fase: Build), do plano aprovado na #2 e do pattern equivalente do lite-campaign (#2)
- **Status**: Active
- **Atualizado**: 2026-09-25 (Fase: Build), o merge passou a citar o refresh do `issue-link`, que ainda não dispensa o veredito fresco, e a auditoria de `main`, que registra o que chega por outro caminho, o merge sem os checks exigidos verdes e o histórico reescrito inclusive, com o que ela não vê; e a PR passou a proibir os tokens de pular CI no título, no corpo e nos commits (#3)
