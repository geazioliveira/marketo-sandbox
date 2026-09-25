# Fluxo de desenvolvimento

Toda mudança segue o mesmo loop: Intent, Build e Learn do Context Mesh, com Plan, Approve e Execute dentro do Build. Este guia dá a ordem e os comandos. As regras de cada passo ficam nos patterns que ele aponta, e a [ADR 0001](../../context/decisions/0001-context-mesh-in-the-repository.md) registra a decisão por trás do loop.

## O loop

Antes de tudo, e de novo antes da PR:

```sh
npm run gate
```

`npm run gate` antes de começar e de novo antes da PR. O gate lê a branch, descobre a issue, e diz quais passos estão feitos, quais faltam e se o Build pode começar. [O gate do loop](../../context/knowledge/patterns/loop-gate.md) diz o que bloqueia, o que só é relatado e o que nenhum script consegue conferir.

1. **Issue.** O plano nasce numa issue de `geazioliveira/marketo-sandbox`, com as seções listadas abaixo, a label de categoria e a label `ready-for-human`. Os forms de issue aplicam as duas. Um relato sem plano entra com `needs-triage`.
2. **Approve.** O dono lê o plano no GitHub, comenta `# Owner Approve` com as próprias palavras e, depois desse comentário, move a label de `ready-for-human` para `ready-for-agent`. A ordem importa: o gate só aceita um `ready-for-agent` aplicado depois do Approve em vigor. O agente nunca faz nenhum dos dois.
3. **Branch.** Uma branch para a issue, cortada do `origin/main`, como manda o [ciclo de vida de issue e branch](../../context/knowledge/patterns/issue-branch-lifecycle.md). Rode `npm run gate` aqui: ele precisa estar aberto antes do primeiro commit.
4. **Intent.** O primeiro commit toca só `context/intent/`: cria ou atualiza o `feature-<slug>.md` ou o `bug-<slug>.md` da issue, com status `In Progress`.
5. **Build.** Implementa o plano aprovado, commit por commit, cada mensagem terminando com `Refs #N`. Se algo muda o plano, pare (veja a seção sobre o plan mode).
6. **Learn.** Na mesma branch, antes de a PR sair de draft: o intent ganha Resultados e o status final (`Completed` ou `Resolved`), o [changelog](../../context/evolution/changelog.md) ganha uma entrada cujo heading cita `(#N)`, e as decisões e os patterns novos entram em `context/`.
7. **Check.** Roda os checks (seção Check, abaixo) e abre a PR com a primeira linha `Closes #N.`.
8. **Review.** A PR é revisada com a profundidade que o risco do plano pede (`HIGH` ou `NORMAL`). CI verde não é revisão.
9. **Merge.** Merge commit, com os checks exigidos verdes, um veredito fresco do gate e a revisão feita (seção Pull requests e merge). Depois, um comentário na issue com o número da PR e o SHA do merge.

## Plan mode do Claude Code

O plano redigido no plan mode do Claude Code é um rascunho do plano de uma issue. Aceitar o plano no Claude Code só autoriza postá-lo na issue. Não autoriza escrever código.

A sequência:

1. No plan mode, o agente redige o plano, com as seções exigidas e o nome exato da branch.
2. O agente cria a issue (`gh issue create … --label enhancement --label ready-for-human`) ou, numa issue que já existe, posta um comentário cuja primeira linha é exatamente `# Plano`.
3. O agente para e informa o link da issue.
4. O dono lê no GitHub, escreve `# Owner Approve` com as próprias palavras e, depois, move a label.
5. Num turno novo, o agente roda `npm run gate` e só então constrói.

- Aprovação no chat não é Approve, e o agente nunca a transcreve para a issue.
- Se o Build descobre algo que muda o plano: o agente para, posta um novo comentário cuja primeira linha é exatamente `# Plano`, com o plano inteiro revisado (isso cancela o Approve, de propósito), e espera o dono aprovar de novo. Depois do novo Approve, o dono remove `ready-for-agent` e a aplica de novo, mesmo que ela nunca tenha saído da issue: o gate só aceita a label aplicada depois do Approve em vigor.

## Seções que uma issue precisa ter

A lista vive em [scripts/loop-sections.mjs](../../scripts/loop-sections.mjs) (`featureSections`, `bugSections` e `optionalSections`), e os forms de issue em `.github/ISSUE_TEMPLATE/` a espelham, com um teste de paridade. Esta página cita a lista. Se as duas divergirem, vale o script.

Feature (label `enhancement`):

- Contexto e porquê: o problema e por que resolvê-lo agora.
- Estado atual: citações medidas do código (arquivo:linha, SHA), inclusive o que contradiz o plano.
- Critérios de aceite: itens de checklist verificáveis; marcados só em context/intent, nunca no corpo.
- Plano: os commits em ordem e o nome exato da branch.
- Riscos: HIGH ou NORMAL e o raciocínio, que decide a profundidade da revisão.
- Perguntas para o Approve: cada uma com recomendação, alternativa e custo.

Bug (label `bug`):

- O que acontece: o comportamento, como quem usa o encontra.
- Como reproduzir: os passos, para que a correção tenha algo que falhe antes.
- Causa raiz: por que acontece, não só onde.
- Onde será corrigido: o arquivo ou a issue que é dona da correção, e o nome exato da branch.
- Critérios de aceite: o teste que falha antes e passa depois.
- Riscos: HIGH ou NORMAL e o raciocínio.

Opcionais, nunca exigidas: Issue mãe, Bloqueada por e Fora de escopo.

- Os headings podem ir de `#` a `####`. A comparação ignora acento, caixa e pontuação no fim, e aceita alguns nomes alternativos em pt-BR (por exemplo, "Contexto" ou "Critérios de aceitação"; a lista está em `alternativeHeadings`). Headings em inglês são recusados de propósito.
- Um heading igual ao nome da seção vence um que só começa com ele: com `### Plano de testes` antes de `### Plano`, a seção Plano é a segunda. Sem nenhum heading igual, vale o primeiro que começa com o nome, como `Riscos: HIGH`.
- Um campo de form deixado em branco (`_No response_`) conta como seção vazia.
- A seção Plano cita o nome exato da branch, como `feature/2-loop-minimo`. Num bug, que não tem Plano, quem cita é a seção Onde será corrigido. O gate procura o nome só dentro dessa seção.
- Os critérios de aceite são itens de checklist (`- [ ] …`), pelo menos um.

## Regras do corpo da issue

- **Nunca edite o corpo depois do Approve.** O gate compara o `lastEditedAt` do corpo com o Approve e bloqueia. Uma revisão entra como um comentário novo cuja primeira linha é exatamente `# Plano` e traz o plano inteiro, porque o último `# Plano` passa a ser o plano vigente.
- **Nem os comentários.** Depois do Approve, editar qualquer comentário, anterior ou posterior a ele, ou apagar qualquer comentário também revoga o Approve. Editar o próprio comentário de Approve não revoga: são as palavras do dono. Uma correção vai num comentário novo.
- **Respostas às perguntas vão em comentário novo**, nunca no corpo.
- **Os critérios são marcados só em `context/intent/*`.** Clicar num checkbox do corpo edita o corpo e revoga o Approve.

## Comentários que o gate lê

O gate lê a primeira linha não vazia de cada comentário da issue, sem os espaços das pontas, e a linha logo abaixo dela, que pode sublinhar a primeira como título. Três primeiras linhas têm sentido, e só escritas exatamente assim: um `#`, um espaço, essa caixa, e nada mais na linha.

| Primeira linha | Quem escreve | Efeito |
| --- | --- | --- |
| `# Owner Approve` | Só o dono, com as próprias palavras nas linhas de baixo | Aprova o plano vigente |
| `# Approve retirado` | O dono | Retira o Approve que estava de pé |
| `# Plano` | O agente ou o dono, com o plano inteiro nas linhas de baixo | Revisa o plano: passa a ser o plano vigente e cancela o Approve que estava de pé |

- **Na dúvida, bloqueia.** Qualquer outra primeira linha numa destas formas de título que mencione "approve", em qualquer caixa, nunca conta como Approve e, depois de um Approve, o cancela. As formas: um heading de `#` a `######`, com os `#` seguidos de espaço ou de letra; uma primeira linha sublinhada com `===` ou `---` na linha de baixo; uma primeira linha inteira em negrito; e qualquer um deles citado com `>`.
- **Prosa não é título.** Uma frase comum que menciona approve não muda nada, e `#5` é uma referência a issue, não um título. Um comentário que não quer mexer no Approve não abre com um título que fale de approve.
- **A label vem depois do Approve.** `ready-for-agent` só conta se a última aplicação dela foi do dono, depois da última reabertura e depois do Approve em vigor.

Exemplos de primeira linha que não é nenhuma das três acima. Um teste confere cada linha desta tabela contra o gate.

| Primeira linha | Efeito |
| --- | --- |
| `## Owner Approve` | Cancela o Approve que estava de pé, e nunca conta como Approve |
| `# owner approve` | Cancela |
| `#Owner Approve` | Cancela |
| `# Approve retirado.` | Cancela |
| `# Retiro o Approve` | Cancela |
| `# Perguntas para o Approve` | Cancela |
| `##### Approve retirado` | Cancela |
| `**Approve retirado**` | Cancela |
| `> # Approve retirado` | Cancela |
| `Approve retirado`, com `===` na linha de baixo | Cancela |
| `Approve retirado`, com `---` na linha de baixo | Cancela |
| `Approve retirado` | Nenhum: é uma frase, não um título |
| `#5 aguarda o Approve` | Nenhum: é uma referência a issue |
| `## Plano` | Nenhum: não é revisão, e o plano vigente não muda |
| `# plano` | Nenhum: não é revisão |
| `# Plano revisado` | Nenhum: não é revisão |

[O gate do loop](../../context/knowledge/patterns/loop-gate.md#a-gramática-do-approve) tem a gramática completa.

## Labels

Toda issue aberta tem exatamente uma label de categoria (`bug` ou `enhancement`) e exatamente uma label de estado. A issue de acompanhamento (#1) fica fora dessa regra.

| Label | Significado | Quem aplica |
| --- | --- | --- |
| `needs-triage` | O dono precisa avaliar esta issue | O agente, só no `gh issue create` de um relato sem plano. Depois, só o dono |
| `needs-info` | Esperando mais informação de quem abriu | Só o dono |
| `ready-for-human` | Precisa de decisão humana, incluindo um Approve ainda não registrado | O form de issue, ou o agente só no `gh issue create` com o plano no corpo. Depois, só o dono |
| `ready-for-agent` | Especificada e aprovada pelo dono: o agente pode construir | Só o dono, depois do Approve, e de novo depois de cada novo Approve |
| `wontfix` | Não será feita (decisão do dono) | Só o dono |

A label de categoria é aplicada pelo form de issue ou pelo agente no `gh issue create`. Trocá-la depois é do dono.

## Issue tracker

As issues ficam em `geazioliveira/marketo-sandbox`. PR não é lugar de pedido: ideias e defeitos são issues.

```sh
# Listar e ler
gh issue list --repo geazioliveira/marketo-sandbox --state open
gh issue view <n> --repo geazioliveira/marketo-sandbox --comments

# Criar uma issue com plano, ou um relato sem plano
gh issue create --repo geazioliveira/marketo-sandbox --title "..." --body-file plano.md --label enhancement --label ready-for-human
gh issue create --repo geazioliveira/marketo-sandbox --title "..." --body-file relato.md --label bug --label needs-triage

# Criar uma sub-issue
gh issue create --repo geazioliveira/marketo-sandbox --parent <n> --title "..." --body-file plano.md --label enhancement --label ready-for-human

# Comentar (a primeira linha de um plano revisado é exatamente "# Plano")
gh issue comment <n> --repo geazioliveira/marketo-sandbox --body-file comentario.md

# Só o dono: mover a label depois do comentário de Approve
gh issue edit <n> --repo geazioliveira/marketo-sandbox --remove-label ready-for-human --add-label ready-for-agent

# Só o dono: aplicar a label de novo depois de um novo Approve (revisão do plano)
gh issue edit <n> --repo geazioliveira/marketo-sandbox --remove-label ready-for-agent
gh issue edit <n> --repo geazioliveira/marketo-sandbox --add-label ready-for-agent

# Abrir a PR (a primeira linha de pr.md é "Closes #N.")
gh pr create --repo geazioliveira/marketo-sandbox --base main --head <branch> --title "..." --body-file pr.md

# Acompanhar os checks
gh pr checks <p> --repo geazioliveira/marketo-sandbox

# Veredito fresco logo antes do merge: re-rodar o issue-link da PR (o id do run está no link do check)
gh pr checks <p> --repo geazioliveira/marketo-sandbox --json name,workflow,link
gh run rerun <run-id> --repo geazioliveira/marketo-sandbox
gh run watch <run-id> --repo geazioliveira/marketo-sandbox --exit-status
# ou, num checkout da head da PR com origin/main buscado, o gate em modo CI (exige saída 0)
node scripts/gate.mjs --pr <p> --branch <branch>

# Mergear
gh pr merge <p> --repo geazioliveira/marketo-sandbox --merge

# Depois do merge
gh issue comment <n> --repo geazioliveira/marketo-sandbox --body "Fechada pela PR #<p> no merge <sha>."
```

- Passe `--repo` sempre. Mais de uma conta pode estar logada na máquina, e uma conta sem acesso vê o repositório como inexistente.
- Use `--body-file` para texto de mais de uma linha. Assim a primeira linha chega exatamente como foi escrita, sem surpresa de quoting do shell.
- Leia de volta toda mudança feita para fora. Um comando com flag errada pode falhar sem erro visível.
- Uma sub-issue nomeia a issue mãe numa seção `Issue mãe`, além do vínculo nativo do `--parent`.

## Pull requests e merge

- **A primeira linha do corpo é `Closes #N.`**, com o número da issue da branch, e a PR fecha só essa issue: nenhuma outra palavra-chave de fechamento no corpo.
- **O template de PR** (`.github/pull_request_template.md`) tem as seções Risco, O que mudou, Verificação, Desvios do plano aprovado, Follow-ups e o checklist do Context Mesh.
- **Os checks exigidos são `Qualidade / check` e `Vínculo com issue / issue-link`**, nomeados por workflow e job. Um job chamado `check` ou `issue-link` que venha de outro workflow não conta: uma PR consegue acrescentar um. No plano Free, o GitHub não consegue torná-los obrigatórios ([ADR 0002](../../context/decisions/0002-soft-enforcement-on-github-free.md)), então a regra é esta: nenhuma PR é mergeada com um check exigido vermelho, e um check ausente conta como vermelho.
- **Veredito fresco antes do merge.** Os eventos da issue (o Approve retirado, um `# Plano` novo, a label movida, uma reabertura) não rodam o `issue-link` de novo, então um verde pode estar velho. Logo antes de mergear, re-rode o job `issue-link` da PR (`gh run rerun`) e espere o resultado, ou rode `node scripts/gate.mjs --pr <p> --branch <branch>` num checkout da head da PR. Só mergeie com o job verde de novo, ou com o gate saindo com 0. O refresh automático chega com a #3.
- **Exceção de bootstrap, só na #2.** A PR da #2 cria o `issue-link`, e por isso não tem esse check no servidor: o workflow ainda não está em `main` ([ADR 0002](../../context/decisions/0002-soft-enforcement-on-github-free.md)). Só nela, a saída do gate em modo CI rodado localmente, colada em "Verificação", faz as vezes do `issue-link`, e o veredito fresco é essa execução refeita logo antes do merge, com saída 0. Da PR da #3 em diante, o `issue-link` do servidor é exigido.
- **PR que mexe em workflow é HIGH.** Uma PR que toca `.github/workflows/**` é revisada como risco HIGH, seja qual for o risco do plano. O `check.yml` roda em `pull_request`, com o YAML da própria PR, então a PR consegue afrouxar o próprio `check`. Só o `issue-link`, que vem de `main`, não pode ser afrouxado pela PR.
- **Merge só por merge commit** (`gh pr merge --merge`). Squash e rebase estão desligados no repositório, e o título e o corpo do merge commit vêm da PR, então o `Closes #N.` chega ao histórico de `main`.
- **Quem mergeia.** O dono deu ao agente uma autorização permanente para mergear, na #2, em 2026-09-24, na resposta à pergunta 3: "Pode mergiar, se já está tudo ok e validado, não vejo problema." Ela vale quando as três condições se cumprem: os checks exigidos estão verdes, o veredito fresco saiu com 0 e a revisão está feita. Faltando uma, o agente não mergeia. O dono revoga a autorização com um comentário, e a partir dele o agente para de mergear.
- **Depois do merge**, comente na issue o número da PR e o SHA do merge. A issue fecha sozinha pelo `Closes #N.`, e a branch remota é apagada pelo repositório.

## Check

Hoje, antes da PR:

```sh
npm run lint && npx tsc --noEmit && npm test && npm run gate
```

- No CI, o job `check` roda `npm ci`, `npm run lint` e `npm test`, e confere que a árvore ficou limpa.
- A #3 vai acrescentar ao `check` o typecheck, o `check:context`, o build e o e2e.
- O `npm run check:all`, que confere se o código gerado é o que os geradores emitem, é uma falha conhecida, acompanhada na #7. Ele fica fora do CI até lá.

## Saída de emergência do dono

Quando os hooks do Claude Code chegarem (#5), o dono pode desligá-los na própria máquina com `"disableAllHooks": true` em `.claude/settings.local.json`, que não é versionado. É um ato do dono: o agente nunca escreve esse arquivo. Desligar os hooks não desliga o gate nem o CI.

## Onde vai um documento novo

| Você está escrevendo | Vai em |
| --- | --- |
| Um plano | Uma issue, nunca um arquivo |
| O que o mock precisa fazer, com critérios de aceite | `context/intent/` |
| Uma escolha relevante e os motivos | `context/decisions/` |
| Uma regra que a revisão confere | `context/knowledge/patterns/` |
| Um erro a não repetir | `context/knowledge/anti-patterns/` (chega com a #4) |
| Uma definição | `context/knowledge/glossary.md` (chega com a #4) |
| O que mudou e o que ensinou | O [changelog](../../context/evolution/changelog.md), no passo Learn |
| Como rodar, mudar ou operar algo | `docs/` |

Cada tipo de arquivo de contexto tem o template e os status possíveis no [guia do Context Mesh](../../context/README.md).
