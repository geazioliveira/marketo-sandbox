# Feature: Revisão do Copilot na cabeça e nenhuma thread aberta antes do merge

## Declaração de intenção

O dono pediu, em 2026-09-25: **"para dar merge precisamos adicionar no gate que os comentários do copilot precisam existir e precisam estar verdes também, não podemos ter comentários abertos ou não resolvidos"**.

As PRs #10 e #11 foram mergeadas antes de a revisão do Copilot chegar, e ficaram com 7 threads abertas (tratadas na #12). Esta feature transforma em gate o que a PR #14 fez à mão:
- uma revisão do Copilot no commit que é a cabeça da PR;
- zero threads de revisão abertas, de qualquer autor.

A auditoria de `main` registra o merge que chegar sem as duas coisas.

## Critérios de aceite

- [ ] `scripts/loop-sections.mjs` guarda os contratos, e o gate, a auditoria, os hooks (#5) e os testes usam essa mesma fonte:
  - `copilotReviewer` (`Bot`, `databaseId` 175728472, login legível);
  - o login de pedido;
  - os estados aceitos (`COMMENTED`, `APPROVED`);
  - as funções puras `copilotReviewOn` e `openThreads`.
- [ ] O modo CI do gate ganha os passos `copilot-review` e `review-threads`. Eles bloqueiam fora de draft, e no modo local dizem "só no modo CI".
  - `copilot-review` exige uma revisão do Copilot, não dispensada, cujo `commit.oid` é a cabeça da PR, e explica como pedi-la.
  - `review-threads` exige zero threads não resolvidas, inclusive as desatualizadas, e lista `path:line` e o link de cada uma.
  - Uma página lida pela metade fica `unchecked` e bloqueia.
- [ ] O re-disparo é confiável:
  - `review-signal.yml` ("Sinal de revisão") roda em `pull_request_review` (`submitted`, `dismissed`) com `permissions: {}` e só sinaliza;
  - `issue-link-refresh.yml` ganha `workflow_run` desse sinal e `workflow_dispatch` com o número da PR;
  - o `refresh-issue-link.mjs` ganha um modo PR.
- [ ] A auditoria de `main` deixa um merge fora do loop quando não houve revisão do Copilot na cabeça antes do merge, ou quando alguma thread aberta até o merge continua não resolvida na hora da auditoria.
- [ ] Nova ADR 0003 (revisão na cabeça e zero threads como condições de merge). A ADR 0002 ganha as camadas e os limites. O `docs/development/workflow.md` e o `AGENTS.md` descrevem o fluxo:
  1. abrir a PR em draft;
  2. ligar o monitor de CI do app;
  3. sair de draft só com o Learn commitado;
  4. esperar o Copilot e pedir de novo a cada push novo;
  5. responder cada thread antes de resolvê-la;
  6. renovar o veredito.
- [ ] Cada regra tem teste, e cada teste falha quando a regra é revertida.
- [ ] A PR desta issue espera a revisão do Copilot na cabeça e tem zero threads abertas no merge. Os passos novos só rodam a partir de `main` na PR seguinte.
- [ ] `npm run check` e o e2e passam, e o gate fica aberto.

## Abordagem técnica

- **Identidade do Copilot.** Ela é casada por `__typename === 'Bot'` e `databaseId`, não pelo login, porque existe uma organização com esse nome.
- **Re-disparo em duas etapas.** Um evento de revisão roda o YAML da própria PR, então o sinal não tem permissão nenhuma. Quem re-executa o `issue-link` é o refresh, que roda de `main`.
- **Threads resolvidas.** Resolver uma thread não dispara evento nenhum. Por isso o agente renova o veredito à mão depois de resolver, e a auditoria julga as threads na hora dela.
- **Resumo da revisão.** Um achado que aparece só no resumo, sem thread, não é lido pelo gate, porque o formato não é documentado. O agente o trata na PR.

## Perguntas em aberto

Respondidas pelo dono no Approve da #13 (2026-09-25), "seguindo suas recomendações":

1. "Verde" é uma revisão do Copilot na cabeça exata e zero threads abertas.
2. "Review new pushes" ligado, com o fluxo draft → `gh pr ready`. Enquanto a configuração não estiver ligada, o agente pede a revisão de novo a cada push (`gh pr edit <n> --add-reviewer @copilot`).
3. O agente resolve uma thread só depois de responder nela com o SHA da correção, uma issue `#N` ou a evidência. Os hooks da #5 fazem isso valer.
4. Um achado que aparece só no resumo não entra no gate, e o agente o trata.
5. Não há bypass para quando o Copilot estiver indisponível: se o dono mergear mesmo assim, a auditoria registra.
6. O re-disparo é em duas etapas.
7. Threads de qualquer autor contam.

## Decisões relacionadas

- [0002: Enforcement soft do loop no GitHub Free](../decisions/0002-soft-enforcement-on-github-free.md)
- 0003: a revisão do Copilot na cabeça e zero threads abertas como condições de merge, criada nesta issue.

## Patterns relacionados

- [O gate do loop](../knowledge/patterns/loop-gate.md)
- [Ciclo de vida de issue e branch](../knowledge/patterns/issue-branch-lifecycle.md)

## Status

- **Criado**: 2026-09-25 (Fase: Intent), do plano aprovado na #13 (#13)
- **Status**: In Progress
