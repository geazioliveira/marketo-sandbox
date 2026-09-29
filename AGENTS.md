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
- Ao publicar um plano completo numa issue em `needs-triage`, o agente troca essa label por `ready-for-human` no mesmo passo, para sinalizar que o dono precisa validá-lo.
- Só o dono escreve o Approve e move `ready-for-human` para `ready-for-agent`. O agente nunca faz nenhum desses dois atos.
- Um plano aceito no plan mode do Claude Code só autoriza postá-lo na issue. Aprovação no chat não é Approve, e o agente nunca a transcreve para a issue.
- Um plano revisado é um comentário cuja primeira linha é exatamente `# Plano`. Nunca abra um comentário com um título que mencione "approve" (heading de qualquer nível, linha sublinhada, linha em negrito, citação): depois de um Approve, isso o cancela. Depois do Approve, não edite o corpo da issue nem comentário nenhum: isso também o revoga.
- Nunca escreva `[skip ci]`, `[ci skip]`, `[no ci]`, `[skip actions]` ou `[actions skip]`, nem o trailer `skip-checks: true`, no título ou no corpo de uma PR, nem numa mensagem de commit: a mensagem do merge é o título e o corpo da PR, e o push do merge ficaria sem o `Qualidade / check` e sem a auditoria de `main` ([o fluxo](docs/development/workflow.md#pull-requests-e-merge)).
- Abra a PR em draft e, logo depois do `gh pr create`, ligue nela o monitor de CI do app (auto-fix e comentários). Tire a PR de draft (`gh pr ready`) só com o Learn commitado.
- Só mergeie com uma revisão do Copilot na cabeça da PR, nenhuma outra revisão dele pedida e ainda a caminho, e nenhuma thread de revisão aberta, de qualquer autor, inclusive as desatualizadas ([ADR 0003](context/decisions/0003-copilot-review-and-no-open-threads-before-merge.md)). Não há bypass. Depois de cada push, leia a timeline da PR (`gh api repos/geazioliveira/marketo-sandbox/issues/<n>/timeline`): sem um `review_requested` do Copilot depois da hora do push e sem revisão dele na cabeça nova em uns 10 min, peça a revisão de novo (`gh pr edit <n> --add-reviewer @copilot`). Uma revisão do Copilot que falhou não conta: peça de novo. Responda em cada thread (o SHA da correção, uma issue `#N` ou a evidência de que não procede) antes de resolvê-la, e trate na PR um achado que só aparece no resumo da revisão. Desde a #30, o `issue-link` só relata a revisão do Copilot e as threads, com um aviso na PR: quem as exige antes do merge é o veredito fresco ([a revisão do Copilot e as threads](docs/development/workflow.md#a-revisão-do-copilot-e-as-threads)).
- Antes de mergear, tire um veredito fresco: rode `node scripts/gate.mjs --pr <n> --branch <branch>` na cabeça da PR e exija saída 0. Um rerun do `issue-link` não é veredito fresco: ele roda com `--review-report` e só relata a revisão e as threads. Um disparo do refresh sozinho também não é veredito fresco. Só mergeie com os checks exigidos verdes e a revisão feita, como diz [o fluxo](docs/development/workflow.md#pull-requests-e-merge).
- Os hooks do Claude Code (`.claude/hooks/`, #5) interrompem, antes da ação, o que contorna o loop. Quando um deles nega ou pede confirmação, a mensagem diz o motivo: resolva a causa, nunca contorne o hook ([os hooks](docs/development/workflow.md#os-hooks-do-claude-code)).
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
| Um hook do Claude Code que negou ou pediu confirmação | [Os hooks do Claude Code](docs/development/workflow.md#os-hooks-do-claude-code) e a [ADR 0002](context/decisions/0002-soft-enforcement-on-github-free.md) |
| O que o CI roda e como rodar o mesmo antes da PR (`npm run check`, o e2e) | [A seção Check do fluxo](docs/development/workflow.md#check) |
| Um problema apontado pelo `npm run check:context` | Os formatos e o layout de `context/` no [guia do Context Mesh](context/README.md). Cada problema sai com `arquivo:linha`, e um arquivo fora do layout é recusado |
| Uma issue `Mudança em main fora do loop: <sha7>` | [A auditoria de main](docs/development/workflow.md#auditoria-de-main). É um relato para o dono: um commit de `main` que não veio de uma PR mergeada que fecha issue com os checks exigidos verdes na head (e, desde `reviewRuleSince`, com a revisão do Copilot na cabeça e nenhuma thread aberta), ou um histórico de `main` reescrito. O dono registra retroativamente ou reverte |
| Como uma branch nasce, anda e é mergeada | [O ciclo de vida de issue e branch](context/knowledge/patterns/issue-branch-lifecycle.md) |
| Uma mudança grande em PRs menores, numa stack | [Stack de PRs](docs/development/workflow.md#stack-de-prs), com uma sub-issue por fatia e o Approve da mãe |
| O que mudou e o que cada mudança ensinou | [O changelog](context/evolution/changelog.md) |
| Os patterns e os anti-patterns, numa lista só | [Os padrões de código](CODING_STANDARDS.md) |
| O sentido de uma palavra do projeto, e as palavras a evitar | [O glossário](context/knowledge/glossary.md) |
| O risco de uma mudança (`HIGH` ou `NORMAL`) e o que a revisão pede em cada caso | [A revisão classificada por risco](context/knowledge/patterns/risk-classified-review.md) |
| O que está em andamento e o que vem depois | As issues abertas em `geazioliveira/marketo-sandbox`, a começar pela de acompanhamento #1, e o `git log` |
| Mexer em código gerado | Nunca edite à mão as pastas geradas de uma área (`src/<área>/<área>-definitions/`, `src/<área>/resources/` e `src/<área>/<área>-mocks/`) nem `src/mocks/`: esse código sai dos geradores em `scripts/*.py`, cada área a partir do seu `docs/marketo-swagger-*.json`. A [ADR 0004](context/decisions/0004-swagger-as-single-source-with-committed-generated-code.md) registra a decisão, e os patterns [gerar e conferir](context/knowledge/patterns/generate-and-check.md) e [a fronteira do código gerado](context/knowledge/patterns/generated-code-boundary.md) dão as regras. Todo arquivo gerado abre com o cabeçalho `// Code generated by … DO NOT EDIT.`, e o `npm run check` roda o `check:all` desde a #7: uma edição num arquivo gerado, um `.ts` a mais numa pasta gerada, ou um `docs/marketo-swagger-*.json` mudado sem regenerar (o registro `swagger-source.ts` de cada área guarda o sha256 dele, [ADR 0012](context/decisions/0012-swagger-source-record-per-area.md)), deixa o CI vermelho |
