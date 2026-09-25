# marketo-sandbox: roteador de agentes

Mock local da API REST do Marketo Engage, gerado a partir do Swagger oficial: cada operação documentada vira uma rota NestJS que responde no formato documentado.
O lite-campaign o consome como "Marketo API mock", para desenvolver e testar sem credenciais e sem uma instância Marketo.

## Context Mesh

A raiz do Context Mesh deste repositório é `context/`. A regra global que manda os arquivos de Context Mesh para um vault externo não vale aqui, como registra a [ADR 0001](context/decisions/0001-context-mesh-in-the-repository.md). Não crie um `CONTEXT.md` na raiz, um `docs/adr/` nem uma pasta no vault: intents, decisões, patterns e changelog já têm lugar em `context/`.

O trabalho segue Intent, Build e Learn, com Plan, Approve e Execute dentro do Build. O [guia do Context Mesh](context/README.md) guarda o layout, os templates, o idioma e o vocabulário de status.

## Antes de qualquer mudança

- Nenhum plano nasce fora de uma issue, e toda PR fecha uma issue. Não existe lane sem issue.
- Rode `npm run gate` antes de começar e de novo antes da PR. Se ele bloquear, pare e resolva o que ele aponta.
- Antes da PR, rode também `npm run check` e o e2e, como diz [a seção Check do fluxo](docs/development/workflow.md#check). É o que o check `Qualidade / check` roda.
- O dono move a label e escreve o Approve. O agente nunca faz nenhum dos dois.
- Um plano aceito no plan mode do Claude Code só autoriza postá-lo na issue. Aprovação no chat não é Approve, e o agente nunca a transcreve para a issue.
- Um plano revisado é um comentário cuja primeira linha é exatamente `# Plano`. Nunca abra um comentário com um título que mencione "approve" (heading de qualquer nível, linha sublinhada, linha em negrito, citação): depois de um Approve, isso o cancela. Depois do Approve, não edite o corpo da issue nem comentário nenhum: isso também o revoga.
- Nunca escreva `[skip ci]`, `[ci skip]`, `[no ci]`, `[skip actions]` ou `[actions skip]`, nem o trailer `skip-checks: true`, no título ou no corpo de uma PR, nem numa mensagem de commit: a mensagem do merge é o título e o corpo da PR, e o push do merge ficaria sem o `Qualidade / check` e sem a auditoria de `main` ([o fluxo](docs/development/workflow.md#pull-requests-e-merge)).
- Abra a PR em draft e, logo depois do `gh pr create`, ligue nela o monitor de CI do app (auto-fix e comentários). Tire a PR de draft (`gh pr ready`) só com o Learn commitado.
- Só mergeie com uma revisão do Copilot na cabeça da PR, nenhuma outra revisão dele pedida e ainda a caminho, e nenhuma thread de revisão aberta, de qualquer autor, inclusive as desatualizadas ([ADR 0003](context/decisions/0003-copilot-review-and-no-open-threads-before-merge.md)). Não há bypass. Depois de cada push, leia a timeline da PR (`gh api repos/geazioliveira/marketo-sandbox/issues/<n>/timeline`): sem um `review_requested` do Copilot depois da hora do push e sem revisão dele na cabeça nova em uns 10 min, peça a revisão de novo (`gh pr edit <n> --add-reviewer @copilot`). Uma revisão do Copilot que falhou não conta: peça de novo. Responda em cada thread (o SHA da correção, uma issue `#N` ou a evidência de que não procede) antes de resolvê-la, e trate na PR um achado que só aparece no resumo da revisão. Resolver uma thread não dispara nada: depois, atualize o check com `gh workflow run issue-link-refresh.yml --ref main -f pr=<n>`, que sozinho não é veredito fresco ([a revisão do Copilot e as threads](docs/development/workflow.md#a-revisão-do-copilot-e-as-threads)).
- Antes de mergear, tire um veredito fresco: rode `node scripts/gate.mjs --pr <n> --branch <branch>` na cabeça da PR e exija saída 0, ou re-rode o `issue-link` da PR (`gh run rerun <run-id>`) e acompanhe-o com `gh run watch <run-id> --exit-status`. Um disparo do refresh sozinho não é veredito fresco. Só mergeie com os checks exigidos verdes e a revisão feita, como diz [o fluxo](docs/development/workflow.md#pull-requests-e-merge).
- Trabalhe só no seu worktree. O checkout principal pode guardar trabalho do dono sem commit.

## Roteamento

| Você precisa de | Leia |
| --- | --- |
| Para que o mock existe, os critérios de aceite e as decisões em aberto do dono | [O project intent](context/intent/project-intent.md) |
| O que uma feature precisa fazer, construída ou planejada | `context/intent/feature-*.md` |
| Um defeito conhecido, a causa e onde ele é corrigido | `context/intent/bug-*.md` |
| Uma decisão, e se ela está Accepted ou Proposed | [O índice de decisões](context/decisions/README.md) |
| Se o trabalho pode começar e quais passos do loop estão feitos | `npm run gate` e [o gate do loop](context/knowledge/patterns/loop-gate.md) |
| Uma PR parada em `copilot-review` ou `review-threads`, ou uma thread de revisão para responder | [A revisão do Copilot e as threads](docs/development/workflow.md#a-revisão-do-copilot-e-as-threads) e a [ADR 0003](context/decisions/0003-copilot-review-and-no-open-threads-before-merge.md) |
| O loop, os comandos `gh`, as labels e as regras da PR | [O fluxo de desenvolvimento](docs/development/workflow.md) |
| O que o CI roda e como rodar o mesmo antes da PR (`npm run check`, o e2e) | [A seção Check do fluxo](docs/development/workflow.md#check) |
| Um problema apontado pelo `npm run check:context` | Os formatos e o layout de `context/` no [guia do Context Mesh](context/README.md). Cada problema sai com `arquivo:linha`, e um arquivo fora do layout é recusado |
| Uma issue `Mudança em main fora do loop: <sha7>` | [A auditoria de main](docs/development/workflow.md#auditoria-de-main). É um relato para o dono: um commit de `main` que não veio de uma PR mergeada que fecha issue com os checks exigidos verdes na head (e, desde `reviewRuleSince`, com a revisão do Copilot na cabeça e nenhuma thread aberta), ou um histórico de `main` reescrito. O dono registra retroativamente ou reverte |
| Como uma branch nasce, anda e é mergeada | [O ciclo de vida de issue e branch](context/knowledge/patterns/issue-branch-lifecycle.md) |
| O que mudou e o que cada mudança ensinou | [O changelog](context/evolution/changelog.md) |
| O que está em andamento e o que vem depois | As issues abertas em `geazioliveira/marketo-sandbox`, a começar pela de acompanhamento #1, e o `git log` |
| Mexer em código gerado | Nunca edite `src/asset/asset-definitions/`, `src/asset/resources/` nem `src/asset/asset-mocks/` à mão: esse código sai dos geradores em `scripts/*.py` a partir de `docs/marketo-swagger-asset.json`. Os detalhes da geração chegam com a #4. Hoje os geradores escrevem no layout antigo e o `npm run check:all` não passa, o que é acompanhado na #7 |
