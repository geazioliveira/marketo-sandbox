# ADR 0002: Enforcement soft do loop no GitHub Free

## Contexto

- `geazioliveira/marketo-sandbox` é um repositório privado de uma conta pessoal no plano Free. Em 2026-09-24, tanto `GET repos/geazioliveira/marketo-sandbox/branches/main/protection` quanto `GET repos/geazioliveira/marketo-sandbox/rulesets` responderam HTTP 403, "Upgrade to GitHub Pro or make this repository public to enable this feature.". Nada no servidor consegue exigir um check verde, uma revisão ou uma issue vinculada antes de um merge, nem impedir um push direto em `main`.
- O dono e o agente usam a mesma conta do GitHub. Todo comentário, label e PR do agente sai com o login do dono.
- O token do `gh` não tem o escopo `project`, então o Projects v2 fica fora de alcance. Issue types só existem em organizações.
- A [ADR 0001](0001-context-mesh-in-the-repository.md) define um loop que precisa ser imposto mesmo assim.

## Decisão

O loop é imposto por camadas que se cobrem. Nenhuma delas basta sozinha.

1. **CI `issue-link`** (workflow `Vínculo com issue`), em `.github/workflows/issue-link.yml`, no evento `pull_request_target`. Ele roda o gate da cópia que está em `main`, por caminho absoluto e em modo CI, que falha fechado. A PR entra só como dados: nada dela é instalado nem executado. Uma PR fora do loop fica vermelha no momento em que o job roda. No Free, vermelho não trava o botão de merge. Quem trava é a regra de revisão antes do merge do [fluxo de desenvolvimento](../../docs/development/workflow.md#pull-requests-e-merge): nunca mergear com um check exigido vermelho, um check ausente conta como vermelho, e logo antes do merge o veredito do `issue-link` é renovado.
2. **Gate local**, `npm run gate`: o mesmo script, no terminal, antes de começar e antes da PR. O [gate do loop](../knowledge/patterns/loop-gate.md) diz o que ele confere.
3. **Hooks do Claude Code** num `.claude/settings.json` commitado. **Ainda não existem: chegam com a #5.** Pelo plano da #5, eles vão impedir o **agente** de pular o loop antes que a ação aconteça: escrever o Approve, mover label de estado e editar fora de `context/intent/` sem o gate aberto, que eles vão ler do cache do gate.
4. **Forms de issue e template de PR em pt-BR**, com os headings que o gate lê, e issues em branco desligadas (`blank_issues_enabled: false`). Um form carrega um plano inteiro, então abre a issue com a label de categoria e `ready-for-human`, esperando o Approve. É orientação, não bloqueio: o dono ainda vê a opção de issue em branco, e o `gh issue create` pula os forms.
5. **Configurações do repositório**, aplicadas em 2026-09-24 com o OK do dono (pergunta 2 da #2): só merge commit (squash e rebase desligados), branch apagada no merge, e título e corpo do merge commit vindos da PR (`PR_TITLE` e `PR_BODY`), para que o `Closes #N.` chegue ao histórico de `main`.
6. **Auditoria de `main`**. **Ainda não existe: chega com a #3.** Cada push em `main` vai ser auditado depois do fato, para que um commit que não chegou por uma PR ligada a uma issue fique visível.

### Limites

Esta decisão não finge ser mais forte do que é.

- **As camadas 3 e 6 ainda não existem.** Os hooks chegam com a #5 e a auditoria de `main` com a #3. Até lá, o loop se apoia no `issue-link`, no gate local, nos forms, nas configurações do repositório e na regra escrita.
- **O dono consegue mergear com vermelho ou dar push direto em `main`.** Nenhuma camada impede o dono. A auditoria da #3 vai tornar isso visível, mas depois do fato; até ela chegar, só o `git log` mostra.
- **O gate não sabe quem escreveu um Approve.** Agente e dono postam com a mesma conta, então um Approve escrito pelo agente em nome do dono é idêntico a um do dono. Até a #5, só a regra escrita impede o auto-Approve. O gate a imprime em toda execução.
- **Os hooks, quando chegarem, só vão valer para sessões do Claude Code que carregam as configurações deste projeto.** Outra ferramenta, outro agente ou uma sessão com os hooks desligados passa ao largo.
- **Um `issue-link` verde envelhece.** O `pull_request_target` só reage a eventos da PR. Os eventos da issue (o Approve retirado, um `# Plano` novo, a label movida, uma reabertura) não rodam o `issue-link` de novo, e vincular uma issue pela barra lateral da PR também não. O check continua verde com um veredito velho. O workflow de refresh chega com a #3. Até lá, a regra de merge do [fluxo](../../docs/development/workflow.md#pull-requests-e-merge) exige um veredito fresco logo antes do merge: re-rodar o job `issue-link` da PR, ou rodar `node scripts/gate.mjs --pr <p> --branch <branch>` na head da PR, e exigir saída 0.
- **Só o `issue-link` resiste à própria PR.** O `check.yml` (workflow `Qualidade`, job `check`) roda em `pull_request`, com o YAML da própria PR: uma PR consegue tirar o `npm test` dele e continuar com um `check` verde, ou acrescentar outro workflow com um job chamado `check` ou `issue-link`. Por isso os checks exigidos são nomeados por workflow e job (`Qualidade / check` e `Vínculo com issue / issue-link`), e uma PR que toca `.github/workflows/**` é de risco HIGH na revisão.
- **PRs de fork ficam vermelhas, de propósito.** Em `pull_request_target`, o `actions/checkout` v7 recusa a head de um fork enquanto `allow-unsafe-pr-checkout` fica desligado. Toda mudança nasce numa branch deste repositório.
- **Os forms são pulados pelo `gh issue create`.** O que segura a forma do plano é o passo `sections` do gate, não o form.

### Caminho de upgrade

Se o repositório passar para Pro, Team, uma organização, ou ficar público, um ruleset em `main` torna `issue-link` e `check` obrigatórios e bloqueia o push direto. Nesse dia, esta decisão ganha uma linha `Atualizado` dizendo o que virou regra do servidor.

## Racional

Cada camada cobre um buraco de outra:

- o `issue-link` não pode ser afrouxado por quem abre a PR, mas não bloqueia o merge e envelhece com os eventos da issue;
- o gate local é rápido e dá o veredito fresco, mas é opcional;
- os hooks, quando chegarem com a #5, vão parar o agente, mas não o dono;
- os forms guiam quem abre pela web, mas não bloqueiam nada.

Empilhadas, elas fazem o caminho certo ser o mais fácil e deixam qualquer desvio visível, sem custo e sem conta nova. O gate do `issue-link` vem de `main` para que uma PR não consiga afrouxar esse check. O `check` não tem essa proteção, e é por isso que a revisão trata como HIGH uma PR que mexe nos workflows.

## Alternativas consideradas

| Opção | Por que não |
| --- | --- |
| GitHub Pro | O dono recusou o custo |
| Tornar o repositório público | O código é privado |
| Git hooks locais (husky) | Ficam numa máquina só, `git commit --no-verify` os pula, e eles não enxergam issue nem Approve |
| Um GitHub App ou bot com conta própria | Resolveria a autoria do Approve, mas é infraestrutura demais para um mock com um dono só |
| Projects v2 para o estado do trabalho | O token não tem o escopo `project`, e um board não impõe nada |

## Consequências

- **Mais fácil**: o loop funciona sem custo e sem conta nova. Cada camada é testável sozinha, e as regras que nenhuma camada impõe estão escritas.
- **Mais difícil**: o merge depende de disciplina. Um CI vermelho precisa ser lido, e mergear com vermelho é uma violação que só a revisão pega hoje (e a auditoria, quando chegar com a #3). Um verde também precisa ser renovado antes do merge, porque os eventos da issue não o atualizam. O dono precisa lembrar de não dar push em `main`.
- Como o CI roda o gate de `main`, uma PR que corrige o gate é julgada pelo gate antigo até ser mergeada.
- A PR da #2, que cria o `issue-link`, não tem esse check no servidor, porque o workflow ainda não está em `main`. Só nela, a saída do gate em modo CI rodado localmente, colada na "Verificação", faz as vezes do `issue-link`, e o veredito fresco antes do merge é essa mesma execução refeita. A primeira execução real é na PR da #3.

## Relacionados

- [ADR 0001: Context Mesh no repositório e loop issue-first](0001-context-mesh-in-the-repository.md), o loop que esta decisão impõe
- [Pattern: O gate do loop](../knowledge/patterns/loop-gate.md)
- [Pattern: Ciclo de vida de issue e branch](../knowledge/patterns/issue-branch-lifecycle.md)
- [Feature: Loop issue-first com gate e vínculo PR↔issue](../intent/feature-issue-first-loop.md)
- A issue de acompanhamento #1, a auditoria de `main` e o refresh (#3), e os hooks do Claude Code (#5)

## Status

- **Criado**: 2026-09-24 (Fase: Intent), das decisões do dono de 2026-09-24 na #1 e das respostas na #2 (#2)
- **Status**: Accepted
- **Atualizado**: 2026-09-24 (Fase: Build), os Limites ganharam o `issue-link` verde que envelhece (com o veredito fresco antes do merge), o `check.yml` que a própria PR consegue afrouxar, as PRs de fork e as camadas 3 e 6 que ainda não existem, depois das revisões adversariais (#2)
