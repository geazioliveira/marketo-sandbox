# ADR 0011: Os geradores formatam sem arquivo de ignore e falham quando não formatam

## Contexto

- **A saída passa pelo Prettier.** Os três geradores formatam o que escrevem com o Prettier de `node_modules`, e o `--check` compara a cópia formatada com a saída commitada ([ADR 0004](0004-swagger-as-single-source-with-committed-generated-code.md), [ADR 0008](0008-toolchain.md)). Se um dos dois lados não for formatado, a comparação mente.
- **O Prettier 3 pula em silêncio um arquivo ignorado, mesmo passado pelo nome.** Ele lê o `.gitignore` e o `.prettierignore` por padrão. No `--write` e no `-l`, sai com 0 sem mensagem; no `--check`, sai com 0 dizendo "All matched files use Prettier code style!" (Prettier 3.9.6, travado no lock; medido na #7).
- **A #6 tirou o `.gitignore` do caminho.** A regra `/.codegen-tmp/` do `.gitignore:41` deixava sem formatação a cópia que o `--check` compara, e os 459 DTOs pareciam defasados. A #6 passou a chamar o Prettier com `--ignore-path .prettierignore` (`3ddceb4:scripts/marketo_codegen.py:229-233`) e registrou que "o Prettier dos geradores lê só o `.prettierignore`" (ADR 0004 e ADR 0008), com a regra de convivência "Não ponha caminhos de `src/` num `.prettierignore`", deixada para a #7.
- **Medido na #7, em `3ddceb4`:**
  - `/.codegen-tmp/` num `.prettierignore` trazia de volta os 459 defasados falsos;
  - uma regra sem âncora, como `identity/`, fazia gerar gravar sem formatar e sair com 0, e depois os três `--check` e o `format:check` respondiam que estava tudo certo;
  - sem o binário do Prettier, `format_with_prettier` retornava sem fazer nada (`3ddceb4:scripts/marketo_codegen.py:227-228`): gerar gravava 829 arquivos sem formatação e saía com 0, e o check acusava 459 defasados sem citar o Prettier;
  - sem node, o gerador mostrava um traceback e saía com 1, com a pasta de saída já apagada e regravada sem formatação, e um `NODE_BIN` sem node era ignorado em silêncio.

## Decisão

- **Nenhum arquivo de ignore alcança a saída gerada.** Os geradores chamam o Prettier com `--write --no-color --no-require-pragma --ignore-path=` e os caminhos relativos à raiz (`scripts/marketo_codegen.py:279-307`). O `--ignore-path=` vazio desliga o `.gitignore` e o `.prettierignore`. Esta decisão substitui "o Prettier dos geradores lê só o `.prettierignore`", que a #6 registrou nas ADRs 0004 e 0008.
- **O gerador confere que o Prettier processou cada arquivo.** Todo caminho passado precisa aparecer no relatório por arquivo do `--write` (`<caminho> <N>ms`, com `(unchanged)` quando nada muda). Um que falte para a execução.
- **O gerador confere o Prettier e o node antes de mexer na saída.** `prettier_environment()` roda antes do `refuse_foreign_files()` e do `rmtree` (`scripts/marketo_codegen.py:263-276`). O node vem do `NODE_BIN`, do `PATH`, de `~/.nvm`, de `/usr/local/bin` ou de `/opt/homebrew/bin`, nessa ordem (`:241-260`), e um `NODE_BIN` sem node é erro.
- **A saída 2 quer dizer "não consegui formatar".** A mensagem vai para o stderr, sem traceback, e diz o que falta. A saída 1 continua querendo dizer defasado, e também cobre as recusas de `--swagger` e `--area` que a #6 trouxe. O argparse também sai com 2 num uso errado, e a mensagem distingue os dois casos.

## Racional

- **Gerar e checar sempre concordam.** Nenhuma regra de ignore faz um lado formatar e o outro não. Medido: com `src/identity/`, `identity-definitions/` ou `/.codegen-tmp/` num `.prettierignore`, os dois saem com 0 e `src/` não muda.
- **A exceção do `.prettierignore` não tinha uso.** O repositório não tem `.prettierignore`, e a própria #6 deixou a exceção só como regra de convivência, apontando para a #7.
- **Só o relatório por arquivo prova o pulo.** `--check` e `-l` depois do `--write` também pulam o arquivo ignorado com saída 0. O relatório já vem no `--write`, sem outra chamada ao Prettier.
- **O `--no-color` e o `--no-require-pragma` protegem a conferência.** Com `CI=true`, como no GitHub Actions, ou com `FORCE_COLOR`, o Prettier pinta o caminho nas linhas `(unchanged)`, e a conferência leria como pulado um arquivo formatado (medido). Um `requirePragma` na config faria o Prettier processar sem formatar, e a flag da CLI vence a config (medido).
- **A saída 2 separa ambiente quebrado de código defasado**, como nos scripts `.mjs` do loop, em que 2 é o script que não conseguiu rodar.

## Alternativas consideradas

| Opção | Por que não |
| --- | --- |
| Manter o `--ignore-path .prettierignore` da #6 e somar a conferência | A exceção vira erro alto, mas o resultado depende da âncora da regra: com `src/identity/`, gerar sai com 2 depois do `rmtree` e o check sai com 0, então o CI não a pega (medido). O dono escolheu esta decisão (pergunta 1 do plano vigente da #7) |
| `--ignore-path` num arquivo sentinela que nunca existe | Funciona, mas reserva um nome na raiz; o `--ignore-path=` faz o mesmo sem arquivo |
| `--ignore-path /dev/null` | Muda a base dos padrões para `/dev`: o `node_modules` que o Prettier sempre acrescenta passaria a casar qualquer ancestral com esse nome (medido) |
| Formatar pela API do Prettier num `scripts/format-generated.mjs` | Não depende do texto do CLI, mas é um arquivo e um contrato Python-Node a mais para manter |
| Só o `--ignore-path=`, sem a conferência | Uma regressão futura voltaria a ser silenciosa |

## Consequências

- **Mais fácil**:
  - um diagnóstico de defasagem é sempre defasagem de verdade;
  - Prettier ou node ausentes aparecem como tais, antes de a saída ser tocada;
  - nenhuma regra de convivência sobre o `.prettierignore`.
- **Mais difícil**:
  - a conferência depende do texto do relatório por arquivo do CLI do Prettier 3. Se ele mudar numa versão futura, o gerador falha alto em toda execução, nunca em silêncio;
  - ela prova que o Prettier processou cada arquivo, não que o formatou. O `--no-require-pragma` cobre o caso conhecido;
  - no modo de gerar, uma falha do próprio Prettier ou da conferência vem depois do `rmtree`: a saída fica sem formatação até um `git checkout -- src`, com a saída 2 e a mensagem. Gerar numa pasta temporária e mover no fim ficou fora da #7;
  - uma regra sobre `src/` num `.prettierignore` ainda tira os arquivos gerados do `format:check`, que lê o `.prettierignore`, mas não do `check:all`.

## Relacionados

- [ADR 0004: O Swagger como fonte única, com o código gerado commitado](0004-swagger-as-single-source-with-committed-generated-code.md), cuja regra do `.prettierignore` esta decisão substitui
- [ADR 0008: A toolchain](0008-toolchain.md), com o Prettier e o Python dos geradores
- [Bug: Os geradores pulam o Prettier em silêncio, não se marcam como gerados e ficam fora do CI](../intent/bug-codegen-header-prettier-ci.md)
- [Pattern: Gerar e conferir](../knowledge/patterns/generate-and-check.md)
- [Anti-pattern: Confiar que a ferramenta processou o arquivo passado pelo nome](../knowledge/anti-patterns/trusting-a-tool-to-process-a-named-file.md)

## Status

- **Criado**: 2026-09-26 (Fase: Build), da pergunta 1 do plano vigente da #7, aceita no Approve do dono (#7)
- **Status**: Accepted
