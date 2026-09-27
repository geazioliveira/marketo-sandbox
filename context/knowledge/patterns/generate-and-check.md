# Pattern: Gerar e conferir

## Resumo

O código gerado só muda pelo gerador ou por um Swagger: regenere com `npm run generate:*`, commite o gerador e a saída em commits separados e prove a saída com `npm run check:*`.

## Problema

- O código gerado de cada área de `src/` sai de três geradores Python, a partir do documento Swagger do alvo dela ([ADR 0004](../../decisions/0004-swagger-as-single-source-with-committed-generated-code.md)). O README manda regenerar essas pastas, nunca editá-las à mão (`README.md:61-62`).
- Antes do loop, a saída e os geradores se separaram:
  - já no `0c8e760`, os geradores emitiam imports com o sufixo `.js` (`0c8e760:scripts/generate-marketo-definitions.py:151`, `0c8e760:scripts/generate-marketo-resources.py:73`), e nenhum arquivo commitado os tem;
  - o `01ee283` criou `check:factories` e `check:all` antes de existir o gerador de factories, que só chegou no `0ef242d`;
  - o `e7a0bb6` moveu as 255 definições de `src/asset-definitions/` para `src/asset/asset-definitions/` sem mudar os geradores ([mover as pastas geradas sem o gerador](../anti-patterns/moving-generated-folders-without-the-generator.md));
  - o `5cc5e09` trocou os stubs por factories, como o gerador do `a967f26` já emitia, mas deixou em 46 controllers e services o prefixo `../../` dos imports, que nenhuma versão do gerador emitia ([editar código gerado à mão](../anti-patterns/hand-editing-generated-code.md)).
- Até a #6, os três `--check` saíam com 1 numa cópia de `origin/main`: 255 definições ausentes ou mudadas, 46 resources mudados e 259 arquivos de factories ausentes (#7). A diferença era só de lugar e de prefixo.
- A #6 fechou essa divergência: os geradores passaram a derivar as pastas e os imports de um registro de alvos (`scripts/marketo_codegen.py:26-72`, `:155-158`). Faltava outra causa para o `check:all` passar. O Prettier 3 lê o `.gitignore`, onde está `/.codegen-tmp/` (`.gitignore:41`), e não formatava a cópia que o `--check` compara, então tudo parecia defasado. O plano da #6 atribuía isso ao fato de a pasta ser oculta, e a medição mostrou que a causa era o `.gitignore`. Corrigidas as duas, o `check:all` passou.

## Solução

### O caminho de uma mudança

1. **Mude a fonte, nunca a saída.** Uma mudança no que é gerado entra em `scripts/generate-marketo-{definitions,resources,factories}.py`, em `scripts/marketo_codegen.py` ou num `docs/marketo-swagger-*.json`. Nada muda à mão nas pastas geradas ([a fronteira do código gerado](generated-code-boundary.md)).
2. **Instale as dependências antes.** Os geradores formatam a saída com o Prettier de `node_modules/.bin/prettier`, rodado por um node que eles procuram no `NODE_BIN`, no `PATH`, em `~/.nvm`, em `/usr/local/bin` e em `/opt/homebrew/bin`. Sem um dos dois, eles param antes de apagar ou comparar qualquer coisa e saem com 2, com uma mensagem que diz o que falta (`scripts/marketo_codegen.py:268-316`); a saída 1 continua querendo dizer defasado ([ADR 0011](../../decisions/0011-generators-format-without-ignore-files.md)). Os scripts rodam com `python3` 3.9 ou mais novo (`package.json:11-16`, [ADR 0008](../../decisions/0008-toolchain.md)).
3. **Regenere.** Rode o gerador que mudou, `npm run generate:definitions`, `generate:resources` ou `generate:factories`, ou os três em ordem com `npm run generate:all` (`package.json:11-17`). Cada um roda todos os alvos, ou só os que vierem depois de `--target`, como `npm run generate:resources -- --target identity` (`scripts/marketo_codegen.py:77-99`). Cada gerador apaga a pasta de saída da área antes de escrever (`scripts/marketo_codegen.py:365-376`): um arquivo que o gerador não emite some. Numa área avulsa, feita com `--swagger` e `--area`, ele recusa em vez de apagar (`scripts/marketo_codegen.py:441-460`).
4. **Commite em dois tempos.** Primeiro o commit do gerador ou do Swagger, depois um commit com a saída regenerada, cada um com `Refs #N`. Com os dois commits, a revisão lê o diff do gerador linha a linha e deixa o diff da saída para o check provar (inferido; confirmar).
   - **Todo commit compila.** Quando a saída muda de lugar, o commit da saída leva junto a linha escrita à mão que a importa, e a mensagem diz isso. Na #6, o `seedMockData()` foi de `src/asset/asset-mocks/` para `src/mocks/`, e o import de `src/main.ts:4` entrou no commit da saída ([mover as pastas geradas sem o gerador](../anti-patterns/moving-generated-folders-without-the-generator.md)).
5. **Prove com o check.** Rode o check do gerador que mudou, `npm run check:definitions`, `check:resources` ou `check:factories`, ou os três com `npm run check:all` (`package.json:12-18`). A saída vai para a Verificação da PR. Desde a #7, o `npm run check`, e com ele o CI, termina com o `check:all` ([Check, no fluxo](../../../docs/development/workflow.md#check)).

```sh
npm ci
npm run generate:all   # ou só o gerador e os alvos que mudaram
npm run check:all      # sai com 0 só quando a saída commitada é a que os geradores emitem
```

### O que o check confere

- O modo `--check` existe nos três geradores (`scripts/generate-marketo-definitions.py:150-166`, `scripts/generate-marketo-resources.py:400-416`, `scripts/generate-marketo-factories.py:308-331`).
- Ele gera tudo em `.codegen-tmp`, com o cabeçalho de gerado, formata com o Prettier e compara arquivo por arquivo com o que está commitado (`scripts/marketo_codegen.py:379-408`).
- O Prettier dos geradores não lê arquivo de ignore nenhum (`--ignore-path=`, `scripts/marketo_codegen.py:319-362`), e cada caminho passado precisa aparecer no relatório por arquivo dele; se faltar um, o gerador sai com 2 ([ADR 0011](../../decisions/0011-generators-format-without-ignore-files.md)). Antes da #7, ele lia o `.prettierignore` (#6), e antes da #6 também o `.gitignore`, que pulava o `.codegen-tmp`.
- Todo arquivo gerado abre com duas linhas `//`: `Code generated by scripts/<gerador>.py from docs/marketo-swagger-<alvo>.json. DO NOT EDIT.` e o comando que o regenera; os 3 de `src/mocks`, comuns às áreas, citam só o gerador, e os de uma área avulsa, as flags `--swagger` e `--area` que a regeneram (`generated_header()`, `scripts/marketo_codegen.py:220-253`). O check o compara como o resto do arquivo, então tirar o cabeçalho é uma edição como outra qualquer.
- Ele acusa arquivo ausente, arquivo mudado e todo `*.ts` a mais na pasta de saída da área, e sai com 1. A mensagem lista até 10 caminhos e dá as duas contagens (`scripts/marketo_codegen.py:393-403`).
- O `.codegen-tmp` é apagado no fim (`scripts/marketo_codegen.py:406-408`) e está no `.gitignore` (`.gitignore:41`).
- Ele não confere a pasta de uma área que saiu do registro, nem a de uma área gerada com `--swagger` e `--area` ([ADR 0004](../../decisions/0004-swagger-as-single-source-with-committed-generated-code.md)).
- **Um `.prettierignore` não alcança os geradores.** Desde a #7, nenhuma regra de ignore faz gerar e checar formatarem diferente. Uma regra sobre `src/` ainda tira os arquivos gerados do `format:check`, que lê o `.prettierignore`, mas não do `check:all`.
- **Não ponha uma config do Prettier que dependa do caminho.** O `--check` formata a cópia em `.codegen-tmp/src/…`: um `overrides` para `src/**`, ou um `.prettierrc` ou `.editorconfig` dentro de `src/`, faz o check formatar diferente de gerar e acusar defasagem logo depois de gerar (#29).

## Quando usar

- Toda mudança num gerador, no `scripts/marketo_codegen.py` ou num Swagger de `docs/`.
- Toda mudança que precisa de um arquivo novo ou diferente numa pasta gerada.
- Na revisão de uma PR que toca uma pasta gerada: sem a saída do `check:*` na Verificação, a saída não está provada.

## Quando NÃO usar

- No código escrito à mão fora das pastas geradas: `src/main.ts`, `src/app.module.ts`, os `src/<área>/<área>.module.ts`, os testes e os scripts `.mjs`. Ele passa pelo `npm run check` de sempre.
- No comportamento (estado, autenticação, falhas, validação). Ele não sai de um gerador: vive ao lado do código gerado ([ADR 0009](../../decisions/0009-behaviour-beside-generated-code.md), Proposed).

## Decisões relacionadas

- [0004: O Swagger como fonte única, com o código gerado commitado](../../decisions/0004-swagger-as-single-source-with-committed-generated-code.md)
- [0008: A toolchain](../../decisions/0008-toolchain.md)
- [0009: Comportamento ao lado do código gerado, nunca dentro](../../decisions/0009-behaviour-beside-generated-code.md)
- [0011: Os geradores formatam sem arquivo de ignore e falham quando não formatam](../../decisions/0011-generators-format-without-ignore-files.md)

## Status

- **Criado**: 2026-09-25 (Fase: Build), registro retroativo de `0c8e760`..`fb4a804` (#4)
- **Status**: Active
- **Atualizado**: 2026-09-26 (Fase: Build), os geradores saem com 2 quando não conseguem formatar, nenhum arquivo de ignore os alcança, todo arquivo gerado abre com o cabeçalho, e o `check:all` roda no `npm run check` e no CI (#7)
