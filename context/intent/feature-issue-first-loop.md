# Feature: Loop issue-first com gate e vínculo PR↔issue

## Declaração de intenção

O dono pediu, em 2026-09-24: **"nunca um plano nasce fora do GitHub issues, e toda PR é vinculada a uma issue"**.

Até agora, nove commits entraram direto em `main`, sem issue e sem PR, e um deles (`5cc5e09`) fez mais do que a mensagem dizia. O repositório é privado, no plano Free, então o GitHub não bloqueia merge nenhum: branch protection e rulesets respondem 403.

Esta feature traz para cá o loop que o lite-campaign já usa, com três defeitos conhecidos do gate de lá corrigidos (brunohab/lite-campaign#124, #122 e #103), e faz dele o único caminho para uma mudança. O loop é:

1. o plano vive numa issue;
2. o Approve é do dono e fica registrado na issue;
3. a branch nomeia a issue;
4. o intent vem primeiro;
5. o Learn fica registrado no changelog;
6. a PR fecha exatamente a issue da branch.

Um gate confere esse caminho no terminal (`npm run gate`) e no CI (`issue-link`). O gate que roda no CI é sempre a cópia que está em `main`, então uma PR não consegue afrouxar o próprio check.

Esta é a primeira fatia do harness acompanhado na #1. As próximas são o CI de qualidade (#3), o registro retroativo (#4) e os hooks do Claude Code (#5).

## Critérios de aceite

- [x] `context/` tem o guia, o índice de decisões, as ADRs 0001 e 0002, este intent, o project intent, os patterns `issue-branch-lifecycle` e `loop-gate`, e o changelog com uma entrada cujo título cita `(#2)`.
- [x] `npm run gate` sai com 0 em `feature/2-loop-minimo` depois do Approve e recusa numa branch `claude/x` cortada de `origin/main`.
- [x] `test/scripts/gate.spec.ts` usa um `gh` falso estrito e cobre:
  - o caso que passa e cada recusa;
  - as três regressões do lite-campaign;
  - a retirada com texto e a revisão por `# Plano`;
  - o corpo editado depois do Approve (`lastEditedAt`);
  - o Approve de bot e a reabertura;
  - o plano vigente vindo de um comentário;
  - a branch cortada de `claude/*`;
  - o drift entre o pattern e as seções;
  - o conjunto fixo de ids de passo.
- [x] Os forms de issue têm rótulos idênticos aos headings de `scripts/loop-sections.mjs` (há um teste de paridade), e `config.yml` desliga issues em branco.
- [x] O template de PR começa com `Closes #` e tem as seções Risco, O que mudou, Verificação, Desvios do plano aprovado, Follow-ups e o checklist do Context Mesh.
- [x] `issue-link.yml`:
  - roda em `pull_request_target` com o job `issue-link`;
  - usa o gate de `main` por caminho absoluto;
  - trata a PR só como dados;
  - tem permissões só de leitura.
- [ ] `check.yml` tem o job `check` (`npm ci`, `lint`, `test`, árvore limpa) e fica verde na PR.
- [x] Existem `AGENTS.md`, `CLAUDE.md` (exatamente `@AGENTS.md`) e `docs/development/workflow.md`.
- [x] `.gitignore`, `.nvmrc` = 24, o `exclude` de `.claude/**` no vitest e o `lint` cobrindo `scripts/`.
- [x] `npm run lint`, `npx tsc --noEmit` e `npm test` passam, e nada em `src/`, `scripts/*.py` ou `README.md` é tocado.
- [ ] A PR abre com `Closes #2.` e traz em "Verificação" a saída do modo CI local do gate.

## Abordagem técnica

- **Fonte única dos contratos.** `scripts/loop-sections.mjs` guarda as regras de branch, as seções, a gramática do Approve, as labels, o plano vigente e o cache. O gate, o CI, os forms e os testes importam esse arquivo em vez de repetir as regras, porque duas cópias de uma lista acabam divergindo: foi isso que causou brunohab/lite-campaign#111.
- **Dados do GitHub.** O gate lê a issue por `gh api graphql`, não por `gh issue view --json`. O `--json` não expõe `lastEditedAt`, nem o tipo do autor, nem o ator de cada label, e o `updatedAt` muda a cada label ou comentário.
- **CI em `pull_request_target`.** O YAML vem de `main`. A PR entra só como dados: nada é instalado nem executado a partir dela, e os arquivos dela são lidos por `git show`.
- **Commits em ordem:** intent, guia e ADRs, gate, templates, CI, roteamento e Learn.

## Perguntas em aberto

As quatro perguntas foram respondidas pelo dono no comentário da #2 (2026-09-24):

1. O push de `main` já foi feito.
2. As configurações do repositório foram aplicadas: só merge commit, branch apagada no merge, título e corpo do merge vindos da PR.
3. O agente pode mergear quando tudo estiver validado.
4. Os rótulos do bloco Status ficam em pt-BR e os tokens em inglês.

## Decisões relacionadas

- [0001: Context Mesh no repositório e loop issue-first](../decisions/0001-context-mesh-in-the-repository.md)
- [0002: Enforcement soft do loop no GitHub Free](../decisions/0002-soft-enforcement-on-github-free.md)

## Patterns relacionados

- [Ciclo de vida de issue e branch](../knowledge/patterns/issue-branch-lifecycle.md)
- [O gate do loop](../knowledge/patterns/loop-gate.md)

## Resultados

O que foi construído está na [entrada do changelog](../evolution/changelog.md). Os desvios do plano:

- **Tamanho.** Cerca de 8,5 mil linhas em vez de 3 mil, quase tudo em testes: `gate.spec.ts`, `loop-sections.spec.ts`, `forms-parity.spec.ts` e `drift.spec.ts` somam mais de 4 mil. Três rodadas de revisão adversarial acrescentaram regras e um teste de regressão para cada defeito achado.
- **O contrato ficou mais estrito que o do plano**, sempre para o lado que bloqueia:
  - a primeira linha do Approve e a do plano são exatas;
  - qualquer título que mencione "approve" e não seja o Approve exato cancela o Approve em pé;
  - `ready-for-agent` precisa vir depois do Approve;
  - qualquer comentário editado, ou apagado, depois do Approve o revoga, exceto o próprio Approve;
  - a branch precisa estar citada dentro da seção Plano (em bug, em "Onde será corrigido");
  - um merge antes do intent precisa ser limpo, e um merge de fora do `origin/main` conta como empilhamento.
- **Os forms aplicam `ready-for-human`**, e não `needs-triage`, porque um form já carrega um plano completo.
- **Um anti-pattern novo:** [dublê de teste estrito na camada errada](../knowledge/anti-patterns/test-double-strict-on-the-wrong-layer.md).
- **Limites conhecidos**, registrados no [gate do loop](../knowledge/patterns/loop-gate.md) e na [ADR 0002](../decisions/0002-soft-enforcement-on-github-free.md):
  - um comentário criado antes da label e editado depois para virar `# Owner Approve` só pode ser fechado lendo `userContentEdits`; os hooks da #5 vão proibir o agente de fazer isso;
  - títulos em HTML (`<h1>`) ou dentro de um item de lista não são lidos;
  - issue-link verde que ficou velho: a regra de renovar o veredito antes do merge cobre isso até a #3.

## Status

- **Criado**: 2026-09-24 (Fase: Intent), do pedido do dono e do plano aprovado na #2 (#2)
- **Status**: In Progress
- **Atualizado**: 2026-09-24 (Fase: Learn), Resultados escritos antes da PR; os dois critérios que dependem da PR são marcados depois do CI dela (#2)
