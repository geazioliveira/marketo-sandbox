# Pattern: Gerar e conferir

## Resumo

O código gerado só muda pelo gerador ou pelo Swagger: regenere com `npm run generate:*`, commite o gerador e a saída em commits separados e prove a saída com `npm run check:*`.

## Problema

- O código de `src/asset/asset-definitions/`, `src/asset/resources/` e `src/asset/asset-mocks/` sai de três geradores Python, a partir de `docs/marketo-swagger-asset.json` ([ADR 0004](../../decisions/0004-swagger-as-single-source-with-committed-generated-code.md)). O README manda regenerar essas pastas, nunca editá-las à mão (`README.md:60-61`).
- Antes do loop, a saída e os geradores se separaram:
  - já no `0c8e760`, os geradores emitiam imports com o sufixo `.js` (`0c8e760:scripts/generate-marketo-definitions.py:151`, `0c8e760:scripts/generate-marketo-resources.py:73`), e nenhum arquivo commitado os tem;
  - o `01ee283` criou `check:factories` e `check:all` antes de existir o gerador de factories, que só chegou no `0ef242d`;
  - o `e7a0bb6` moveu as 255 definições de `src/asset-definitions/` para `src/asset/asset-definitions/` sem mudar os geradores ([mover as pastas geradas sem o gerador](../anti-patterns/moving-generated-folders-without-the-generator.md));
  - o `5cc5e09` trocou os stubs por factories, como o gerador do `a967f26` já emitia, mas escreveu à mão o prefixo `../../` dos imports de 46 controllers e services, que nenhuma versão do gerador emite ([editar código gerado à mão](../anti-patterns/hand-editing-generated-code.md)).
- Hoje os geradores de definições e de factories ainda escrevem no layout antigo (`scripts/generate-marketo-definitions.py:23`, `scripts/generate-marketo-factories.py:27`). O de resources escreve no lugar certo, mas emite imports `../../../` (`scripts/generate-marketo-resources.py:59,63`), e a saída commitada usa `../../` (`src/asset/resources/snippets/snippets.service.ts:2-10`). Os três `--check` saem com 1 numa cópia de `origin/main`: 255 definições ausentes ou mudadas, 46 resources mudados e 259 arquivos de factories ausentes, e nenhum arquivo a mais nos três. É a #7.
- A diferença é só de lugar e de prefixo. Gerados na mesma cópia, os 255 arquivos de definições e os 259 de factories saem idênticos aos commitados, só nas pastas antigas, e os 46 resources diferem só no prefixo dos imports.

## Solução

### O caminho de uma mudança

1. **Mude a fonte, nunca a saída.** Uma mudança no que é gerado entra em `scripts/generate-marketo-{definitions,resources,factories}.py`, em `scripts/marketo_codegen.py` ou em `docs/marketo-swagger-asset.json`. Nada muda à mão nas três pastas geradas ([a fronteira do código gerado](generated-code-boundary.md)).
2. **Instale as dependências antes.** Os geradores formatam a saída com o Prettier de `node_modules/.bin/prettier` e pulam a formatação em silêncio quando ele não existe (`scripts/marketo_codegen.py:80-83`). Sem `npm ci`, o check compara a saída sem formatação com os arquivos formatados: um arquivo que só difere na formatação aparece como mudado. A #7 planeja fazer o gerador falhar nesse caso, em vez de pular. Os scripts rodam com `python3` (`package.json:11-16`), e nenhuma versão de Python está declarada ([ADR 0008](../../decisions/0008-toolchain.md)).
3. **Regenere.** Rode o gerador que mudou, `npm run generate:definitions`, `generate:resources` ou `generate:factories`, ou os três em ordem com `npm run generate:all` (`package.json:11-17`). Cada gerador apaga a pasta de saída inteira antes de escrever (`scripts/marketo_codegen.py:92-101`): um arquivo que o gerador não emite some.
4. **Commite em dois tempos.** Primeiro o commit do gerador ou do Swagger, depois um commit só com a saída regenerada, cada um com `Refs #N`. O histórico já tem esse corte: o `0ef242d` trouxe só `scripts/generate-marketo-factories.py` e `scripts/marketo_codegen.py`, e o `b91681a` trouxe só os 259 arquivos gerados. Mas o `b91681a` os pôs em `src/asset/asset-mocks/`, e o gerador escreve em `src/asset-mocks/` (`scripts/generate-marketo-factories.py:27`): sem o check, o corte não provou que a saída é a do gerador. Com os dois commits, a revisão lê o diff do gerador linha a linha e deixa o diff da saída para o check provar (inferido; confirmar).
5. **Prove com o check.** Rode o check do gerador que mudou, `npm run check:definitions`, `check:resources` ou `check:factories`, ou os três com `npm run check:all` (`package.json:12-18`). A saída vai para a Verificação da PR.

```sh
npm ci
npm run generate:all   # ou só o gerador que mudou
npm run check:all      # sai com 0 só quando a saída commitada é a que os geradores emitem
```

### O que o check confere

- O modo `--check` existe nos três geradores (`scripts/generate-marketo-definitions.py:171-176`, `scripts/generate-marketo-resources.py:287-292`, `scripts/generate-marketo-factories.py:302-307`).
- Ele gera tudo em `.codegen-tmp` (`scripts/marketo_codegen.py:16`), formata com o Prettier e compara arquivo por arquivo com o que está commitado (`scripts/marketo_codegen.py:104-132`).
- Ele acusa arquivo ausente, arquivo mudado e todo `*.ts` a mais na pasta de saída, e sai com 1. A mensagem lista até 10 caminhos e dá as duas contagens (`scripts/marketo_codegen.py:122-127`).
- O `.codegen-tmp` é apagado no fim (`scripts/marketo_codegen.py:130-132`) e está no `.gitignore` (`.gitignore:41`).

### Enquanto a #7 estiver aberta

- **O `check:all` não passa** e fica fora do `npm run check` e do CI até a #7 ([Check, no fluxo](../../../docs/development/workflow.md#check)).
- **Não rode `generate:definitions` nem `generate:factories`.** Eles recriam as pastas no layout antigo, em `src/asset-definitions/` e em `src/asset-mocks/`, ao lado das commitadas (#7).
- **Não rode `generate:resources` para commitar a saída.** Ela sairia com imports para `src/asset-definitions/` e `src/asset-mocks/`, que não existem (`scripts/generate-marketo-resources.py:59,63`).
- **Não compense à mão.** Uma mudança que precisa de código gerado novo espera a #7. Se não puder esperar, isso vira uma pergunta para o Approve no plano da issue, nunca um ajuste na saída.
- **O `check:resources` ainda serve de alarme.** Hoje ele acusa 46 arquivos mudados e nenhum a mais, só pelo prefixo dos imports. Outra contagem, ou uma diferença que não seja o prefixo, é deriva nova.
- A #6, a reescrita multi-API do dono, talvez feche a #7 junto (inferido; confirmar). A #1 e a própria #7 registram a mesma inferência. Quando a #7 fechar, o `check:all` entra no `npm run check` e no CI, como pede o [project intent](../../intent/project-intent.md).

## Quando usar

- Toda mudança num gerador, no `scripts/marketo_codegen.py` ou no Swagger de assets.
- Toda mudança que precisa de um arquivo novo ou diferente numa das três pastas geradas.
- Na revisão de uma PR que toca uma das três pastas: sem a saída do `check:*` na Verificação, a saída não está provada.

## Quando NÃO usar

- No código escrito à mão fora das três pastas: `src/main.ts`, `src/app.module.ts`, `src/asset/asset.module.ts`, os testes e os scripts `.mjs`. Ele passa pelo `npm run check` de sempre.
- No comportamento (estado, autenticação, falhas, validação). Ele não sai de um gerador: vive ao lado do código gerado ([ADR 0009](../../decisions/0009-behaviour-beside-generated-code.md), Proposed).

## Decisões relacionadas

- [0004: O Swagger como fonte única, com o código gerado commitado](../../decisions/0004-swagger-as-single-source-with-committed-generated-code.md)
- [0008: A toolchain](../../decisions/0008-toolchain.md)
- [0009: Comportamento ao lado do código gerado, nunca dentro](../../decisions/0009-behaviour-beside-generated-code.md)

## Status

- **Criado**: 2026-09-25 (Fase: Build), registro retroativo de `0c8e760`..`fb4a804` (#4)
- **Status**: Active
