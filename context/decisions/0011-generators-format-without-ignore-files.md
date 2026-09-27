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

- **Nenhum arquivo de ignore alcança a saída gerada.** Os geradores chamam o Prettier com `--write --no-color --no-require-pragma --range-start=0 --range-end=Infinity --ignore-path=` e os caminhos relativos à raiz (`scripts/marketo_codegen.py:319-362`). O `--ignore-path=` vazio desliga o `.gitignore` e o `.prettierignore`. Esta decisão substitui "o Prettier dos geradores lê só o `.prettierignore`", que a #6 registrou nas ADRs 0004 e 0008.
- **O gerador confere que o Prettier processou cada arquivo.** Todo caminho passado precisa aparecer no relatório por arquivo do `--write` (`<caminho> <N>ms`, com `(unchanged)` quando nada muda). Um que falte para a execução. As variáveis `PRETTIER_*` saem do ambiente do Prettier, porque mudam o que o CLI imprime: o `PRETTIER_EXPERIMENTAL_CLI` formata sem esse relatório, e o `PRETTIER_PERF_REPEAT` nem grava nem relata.
- **O gerador confere o Prettier e o node antes de mexer na saída.** O Prettier precisa existir e ser executável, e um que não roda sai com 2 mesmo assim. `prettier_environment()` roda antes do `refuse_foreign_files()` e do `rmtree` (`scripts/marketo_codegen.py:294-316`). O node vem do `NODE_BIN`, do `PATH`, de `~/.nvm`, de `/usr/local/bin` ou de `/opt/homebrew/bin`, nessa ordem, e só conta um `node` que é arquivo executável (`:268-291`), e um `NODE_BIN` sem um node executável é erro. A pasta escolhida entra no `PATH` do Prettier como caminho absoluto, porque ele roda com `cwd` na raiz.
- **A saída 2 quer dizer "não consegui formatar".** A mensagem vai para o stderr, sem traceback, e diz o que falta. A saída 1 continua querendo dizer defasado, e também cobre as recusas de `--swagger` e `--area` que a #6 trouxe e a recusa de duas rotas que se capturam uma à outra, que a #8 trouxe ([ADR 0005](0005-nestjs-express-one-module-per-tag.md)). O argparse também sai com 2 num uso errado, e a mensagem distingue os dois casos. Um traceback, como o de um Python anterior ao 3.9 ([ADR 0008](0008-toolchain.md)), sai com 1. No modo de gerar, a mensagem de saída 2 diz também como desfazer a pasta que já foi regravada: rodar o gerador de novo quando o Prettier funcionar, ou, numa área registrada, `git checkout` e `git clean` na pasta, e numa área avulsa, apagá-la.

## Racional

- **Nenhuma regra de ignore separa gerar de checar.** Nenhuma delas faz um lado formatar e o outro não. Medido: com `src/identity/`, `identity-definitions/` ou `/.codegen-tmp/` num `.prettierignore`, os dois saem com 0 e `src/` não muda.
- **A exceção do `.prettierignore` não tinha uso.** O repositório não tem `.prettierignore`, e a própria #6 deixou a exceção só como regra de convivência, apontando para a #7.
- **Só o relatório por arquivo prova o pulo.** `--check` e `-l` depois do `--write` também pulam o arquivo ignorado com saída 0. O relatório já vem no `--write`, sem outra chamada ao Prettier.
- **O `--no-color`, o `--no-require-pragma` e o range protegem a conferência.** Com `CI=true`, como no GitHub Actions, ou com `FORCE_COLOR`, o Prettier pinta o caminho nas linhas `(unchanged)`, e a conferência leria como pulado um arquivo formatado (medido). Um `requirePragma` na config faria o Prettier processar sem formatar, e a flag da CLI vence a config (medido). Um `rangeStart` ou `rangeEnd` na config faz o mesmo, e o range da CLI, do arquivo inteiro, também vence (medido na revisão adversarial da #7).
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
  - nenhuma regra de ignore produz uma defasagem falsa nem um verde falso;
  - Prettier ou node ausentes aparecem como tais, antes de a saída ser tocada;
  - nenhuma regra de convivência sobre o `.prettierignore`.
- **Mais difícil**:
  - a conferência depende do texto do relatório por arquivo do CLI do Prettier 3. Se ele mudar numa versão futura, o gerador falha alto em toda execução, nunca em silêncio;
  - ela prova que o Prettier processou cada arquivo, não que o formatou. O `--no-require-pragma` e o range cobrem os casos conhecidos;
  - uma config do Prettier que dependa do caminho (um `overrides` para `src/**`, ou um `.prettierrc` ou `.editorconfig` dentro de `src/`) faz o `--check` formatar diferente de gerar, porque a cópia dele fica em `.codegen-tmp/src/…`: gerar sai com 0 e o check acusa defasagem (medido, #29);
  - no modo de gerar, uma falha do próprio Prettier ou da conferência vem depois do `rmtree`: a saída fica sem formatação até o gerador rodar de novo, ou até um `git checkout` e um `git clean` na pasta, com a saída 2 e a mensagem, que diz qual pasta e como. Gerar numa pasta temporária e mover no fim ficou para a #29;
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
