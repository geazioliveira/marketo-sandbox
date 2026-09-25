# marketo-sandbox: roteador de agentes

Mock local da API REST do Marketo Engage, gerado a partir do Swagger oficial: cada operação documentada vira uma rota NestJS que responde no formato documentado.
O lite-campaign o consome como "Marketo API mock", para desenvolver e testar sem credenciais e sem uma instância Marketo.

## Context Mesh

A raiz do Context Mesh deste repositório é `context/`. A regra global que manda os arquivos de Context Mesh para um vault externo não vale aqui, como registra a [ADR 0001](context/decisions/0001-context-mesh-in-the-repository.md). Não crie um `CONTEXT.md` na raiz, um `docs/adr/` nem uma pasta no vault: intents, decisões, patterns e changelog já têm lugar em `context/`.

O trabalho segue Intent, Build e Learn, com Plan, Approve e Execute dentro do Build. O [guia do Context Mesh](context/README.md) guarda o layout, os templates, o idioma e o vocabulário de status.

## Antes de qualquer mudança

- Nenhum plano nasce fora de uma issue, e toda PR fecha uma issue. Não existe lane sem issue.
- Rode `npm run gate` antes de começar e de novo antes da PR. Se ele bloquear, pare e resolva o que ele aponta.
- O dono move a label e escreve o Approve. O agente nunca faz nenhum dos dois.
- Um plano aceito no plan mode do Claude Code só autoriza postá-lo na issue. Aprovação no chat não é Approve, e o agente nunca a transcreve para a issue.
- Um plano revisado é um comentário cuja primeira linha é exatamente `# Plano`. Nunca abra um comentário com um título que mencione "approve" (heading de qualquer nível, linha sublinhada, linha em negrito, citação): depois de um Approve, isso o cancela. Depois do Approve, não edite o corpo da issue nem comentário nenhum: isso também o revoga.
- Antes de mergear, renove o veredito do gate (re-rode o `issue-link` ou rode o gate em modo CI) e só mergeie com os checks exigidos verdes e a revisão feita, como diz [o fluxo](docs/development/workflow.md#pull-requests-e-merge).
- Trabalhe só no seu worktree. O checkout principal pode guardar trabalho do dono sem commit.

## Roteamento

| Você precisa de | Leia |
| --- | --- |
| Para que o mock existe, os critérios de aceite e as decisões em aberto do dono | [O project intent](context/intent/project-intent.md) |
| O que uma feature precisa fazer, construída ou planejada | `context/intent/feature-*.md` |
| Um defeito conhecido, a causa e onde ele é corrigido | `context/intent/bug-*.md` |
| Uma decisão, e se ela está Accepted ou Proposed | [O índice de decisões](context/decisions/README.md) |
| Se o trabalho pode começar e quais passos do loop estão feitos | `npm run gate` e [o gate do loop](context/knowledge/patterns/loop-gate.md) |
| O loop, os comandos `gh`, as labels e as regras da PR | [O fluxo de desenvolvimento](docs/development/workflow.md) |
| Como uma branch nasce, anda e é mergeada | [O ciclo de vida de issue e branch](context/knowledge/patterns/issue-branch-lifecycle.md) |
| O que mudou e o que cada mudança ensinou | [O changelog](context/evolution/changelog.md) |
| O que está em andamento e o que vem depois | As issues abertas em `geazioliveira/marketo-sandbox`, a começar pela de acompanhamento #1, e o `git log` |
| Mexer em código gerado | Nunca edite `src/asset/asset-definitions/`, `src/asset/resources/` nem `src/asset/asset-mocks/` à mão: esse código sai dos geradores em `scripts/*.py` a partir de `docs/marketo-swagger-asset.json`. Os detalhes da geração chegam com a #4. Hoje os geradores escrevem no layout antigo e o `npm run check:all` não passa, o que é acompanhado na #7 |
