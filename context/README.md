# Context

Esta pasta é o Context Mesh do marketo-sandbox. Ela guarda o que o mock precisa fazer, as decisões por trás dele, as regras que o trabalho segue e como o projeto mudou. O trabalho passa por Intent, Build e Learn, com Plan, Approve e Execute dentro do Build.

A [ADR 0001](decisions/0001-context-mesh-in-the-repository.md) registra essa escolha e cada ponto em que este layout se afasta da árvore canônica do Context Mesh. O [fluxo de desenvolvimento](../docs/development/workflow.md) dá os passos do loop e diz onde vai um documento novo.

## Layout

| Pasta ou arquivo | O que guarda |
| --- | --- |
| [intent/](intent/) | O que está sendo construído e por quê, com critérios de aceite: `project-intent.md`, um `feature-<slug>.md` por feature e um `bug-<slug>.md` por bug |
| [decisions/](decisions/) | Uma escolha relevante por arquivo, `NNNN-<slug>.md`, indexadas com o status em [decisions/README.md](decisions/README.md) |
| [knowledge/patterns/](knowledge/patterns/) | Regras que o trabalho segue e que a revisão confere |
| `knowledge/anti-patterns/` | Erros cometidos aqui e o que fazer em vez disso. O primeiro chegou com a #2; a #4 traz os do histórico |
| `knowledge/glossary.md` | O vocabulário do projeto, com as palavras a evitar. Chega com a #4 |
| [evolution/changelog.md](evolution/changelog.md) | Uma entrada por mudança mergeada, escrita no passo Learn |

## Idioma e tokens

O dono decidiu que os artefatos ficam em pt-BR (#1). O que um script lê, o GitHub interpreta ou o código usa como nome fica em inglês.

| O quê | Idioma | Por quê |
| --- | --- | --- |
| Prosa de arquivos de contexto, docs, issues, PRs, forms, templates e mensagens do gate | pt-BR | Decisão do dono |
| Headings de seção dos templates e rótulos do bloco Status (`Criado`, `Status`, `Atualizado`, `Fase`) | pt-BR | Resposta do dono à pergunta 4 da #2 |
| Nomes de arquivo, de branch e de label, e identificadores de código | Inglês | São nomes, não prosa, e o código os usa como estão |
| Tokens de status: `Draft`, `In Progress`, `Completed`, `Resolved`, `Deprecated`, `Proposed`, `Accepted`, `Superseded`, `Active` | Inglês | Scripts os leem, e eles casam com o vocabulário do Context Mesh |
| Tokens de fase: `Intent`, `Build`, `Learn` | Inglês | Idem |
| Tokens de risco: `HIGH`, `NORMAL` | Inglês | Idem |
| `Closes #N.` | Inglês | O GitHub só reconhece palavras-chave de fechamento em inglês |
| `# Owner Approve` | Inglês | O gate procura essa linha exata |
| `# Approve retirado` e `# Plano` | pt-BR (`Approve` fica como token) | O gate procura essas linhas exatas |

## O Approve e o plano na issue

O gate lê a primeira linha não vazia de cada comentário da issue, sem os espaços das pontas, e a linha logo abaixo dela. Três primeiras linhas têm sentido, e só escritas exatamente assim (um `#`, um espaço, essa caixa):

- `# Owner Approve`: o Approve, escrito só pelo dono e seguido das palavras dele.
- `# Approve retirado`: retira o Approve que estava de pé.
- `# Plano`: um plano revisado, inteiro, que passa a ser o plano vigente e cancela o Approve.

Em volta dessas três linhas:

- **Na dúvida, bloqueia.** Qualquer outra primeira linha numa destas formas de título que mencione "approve", em qualquer caixa, nunca conta como Approve e, depois de um Approve, o cancela: um heading de `#` a `######` (`## Owner Approve`, `# Approve retirado.`, `##### Approve retirado`), uma primeira linha sublinhada com `===` ou `---`, uma primeira linha inteira em negrito (`**Approve retirado**`), e qualquer um deles citado com `>`. Uma frase comum que menciona approve, ou uma referência como `#5`, não muda nada.
- **A label vem depois do Approve.** `ready-for-agent` só conta se o dono a aplicou depois do Approve em vigor. Depois de uma revisão e de um novo Approve, o dono remove a label e a aplica de novo.
- **O Approve vale para o texto que o dono leu.** Depois dele, bloqueiam o gate: o corpo da issue editado, qualquer outro comentário editado depois do Approve, anterior ou posterior a ele, e qualquer comentário apagado. Editar o próprio Approve não bloqueia, porque são as palavras do dono.
- **A branch é nomeada dentro da seção Plano** do plano vigente (num bug, que não tem Plano, dentro de Onde será corrigido), não em qualquer lugar do texto.

A gramática completa e o que o gate não consegue ver estão no [gate do loop](knowledge/patterns/loop-gate.md#a-gramática-do-approve).

## Vocabulário de status

| Arquivo | Status possíveis |
| --- | --- |
| Project intent ou feature | `Draft`, `In Progress`, `Completed`, `Deprecated` |
| Bug | `Draft`, `In Progress`, `Resolved`, `Deprecated` |
| Decisão | `Proposed`, `Accepted`, `Superseded`, `Deprecated` |
| Pattern ou anti-pattern | `Active`, `Superseded`, `Deprecated` |

- **Mesmo escopo, mesmo arquivo.** Uma mudança numa feature que já existe atualiza o intent dela. Um escopo novo ganha um arquivo novo.
- **Arquivos de contexto nunca são apagados.** Um arquivo substituído vira `Superseded` ou `Deprecated` e aponta para o substituto.
- **O status muda na PR que muda o que o arquivo descreve**, nem antes nem depois.
- Uma decisão pode ser `Accepted` antes de existir o código que a executa. Nesse caso, as Consequências dizem onde esse trabalho entra.

## O bloco Status

Todo intent, decisão, pattern e anti-pattern termina com um único bloco Status, e nenhum outro lugar do arquivo declara o status. Os índices (`README.md`), o glossário e o changelog não têm bloco Status.

```markdown
## Status

- **Criado**: AAAA-MM-DD (Fase: Intent | Build | Learn), <de onde veio> (#issue)
- **Status**: <um valor do vocabulário acima>
- **Atualizado**: AAAA-MM-DD (Fase: Intent | Build | Learn), <o que mudou e por quê> (#issue)
```

- Uma decisão mantém todas as linhas `Atualizado`, da mais antiga para a mais nova, porque uma emenda faz parte do registro. Os outros arquivos mantêm só a última; o `git log` guarda o resto.
- Uma decisão `Superseded` acrescenta, depois de `Status`, a linha `- **Substituída por**: [NNNN: <título>](NNNN-<slug>.md)`.
- O título diz o tipo do arquivo em inglês e o assunto em pt-BR, separados por dois-pontos: `# Project intent: marketo-sandbox`, `# Feature: <título>`, `# Bug: <título>`, `# ADR 0001: <título>`, `# Pattern: <nome>`, `# Anti-pattern: <nome>`.

## Templates

Mantenha a ordem das seções. Uma seção opcional sem nada a dizer fica de fora, exceto "Decisões relacionadas", que diz "Nenhuma ainda.". Todo template, menos a entrada do changelog, termina com o bloco Status acima.

### Project intent

```markdown
# Project intent: <nome do projeto>

## Declaração de intenção

- **Problema.** <o problema que o projeto resolve>
- **Valor.** <o valor para quem usa>
- **Visão.** <como é o sucesso>
- **Usuários.** <quem usa e em que papel>

## Tipo de projeto

<serviço, biblioteca, CLI e assim por diante>

## Stack

<a stack, com link para as decisões que a escolheram>

## Critérios de aceite

- [ ] <um critério do projeto inteiro>

## Fora de escopo

- <o que explicitamente não será feito>

## Decisões em aberto

- <uma pergunta que só o dono resolve, e o que espera por ela>
```

### Feature

```markdown
# Feature: <título>

## Declaração de intenção

<o que está sendo construído, para quem e por que importa>

## Critérios de aceite

- [ ] <um comportamento observável>

## Abordagem técnica

<a abordagem, depois que as decisões por trás dela estão tomadas>

## Perguntas em aberto

- <opcional: o que ainda não se sabe>

## Decisões relacionadas

- [NNNN: <título>](../decisions/NNNN-<slug>.md)

## Patterns relacionados

- [<nome do pattern>](../knowledge/patterns/<nome>.md)

## Resultados

- <escrito no Learn: o que foi construído, onde se afastou do plano e a PR>
```

### Bug

```markdown
# Bug: <título>

## Descrição

- **Esperado.** <o que deveria acontecer>
- **Atual.** <o que acontece>
- **Reprodução.** <os passos, ou o teste que falha>

## Causa raiz

<por que acontece, quando se souber>

## Abordagem da correção

<como será corrigido>

## Critérios de aceite

- [ ] <o teste que falha antes da correção e passa depois>

## Decisões relacionadas

- [NNNN: <título>](../decisions/NNNN-<slug>.md)

## Resultados

- <escrito no Learn: o que mudou e se a causa raiz se confirmou>
```

### Decisão

As decisões são numeradas com quatro dígitos, a partir da maior que existe.

```markdown
# ADR NNNN: <título>

## Contexto

<a situação ou a restrição que forçou uma escolha>

## Decisão

<o que foi decidido, de forma declarativa>

## Racional

<por que esta opção serve aqui>

## Alternativas consideradas

| Opção | Por que não |
| --- | --- |
| <opção> | <motivo> |

## Consequências

- **Mais fácil**: <o que fica mais fácil>
- **Mais difícil**: <o que fica mais difícil ou mais restrito>

## Relacionados

- <as decisões, intents e patterns de que esta depende ou que ela molda>
```

### Pattern

```markdown
# Pattern: <nome>

## Resumo

<uma frase>

## Problema

<a situação que ele resolve, e o que deu errado sem ele>

## Solução

<a regra ou a técnica, com um exemplo curto quando ajuda>

## Quando usar

- <situação>

## Quando NÃO usar

- <situação>

## Decisões relacionadas

- [NNNN: <título>](../../decisions/NNNN-<slug>.md)
```

### Anti-pattern

```markdown
# Anti-pattern: <nome>

## Resumo

<o erro, em uma frase>

## Problema

<por que falha aqui, citando a issue ou o commit onde aconteceu>

## O que fazer em vez disso

<o caminho certo, com link para o pattern se houver um>

## Exemplo do erro

<um trecho curto do código ou da decisão que deu errado>
```

### Entrada do changelog

As entradas ficam no topo do [changelog](evolution/changelog.md), da mais nova para a mais antiga, separadas por uma linha `---`.

O commit de Learn é feito antes de a PR sair de draft, então a entrada nasce citando a issue. Depois que a PR abre, dá para acrescentar `, PR #n` dentro dos mesmos parênteses: `(#2, PR #10)`. "Números medidos" é opcional e fica de fora quando a entrada não tem nenhum.

```markdown
## AAAA-MM-DD: <o que mudou> (#issue)

**Fase**: Learn
**Tipo**: Feature | Bug Fix | Refactor | Decision | Process | Retroactive

### O que foi construído / corrigido

- <resumo>

### Números medidos

- <uma contagem, uma duração ou um hash, com o comando que o produziu>

### Decisões tomadas

- [NNNN: <título>](../decisions/NNNN-<slug>.md): <uma linha>

### Patterns aplicados ou criados

- [<nome do pattern>](../knowledge/patterns/<nome>.md)

### Aprendizados / surpresas

- <o que muda o jeito de fazer o próximo trabalho>
```

O passo `learn` do gate exige um **heading de entrada** exatamente nesse formato, citando `(#N)` da issue da branch, que não existia no changelog no merge-base com `origin/main`. Uma menção a `#N` em outro lugar do changelog não conta, e uma entrada herdada de `main` também não. O [gate do loop](knowledge/patterns/loop-gate.md) explica por quê.
