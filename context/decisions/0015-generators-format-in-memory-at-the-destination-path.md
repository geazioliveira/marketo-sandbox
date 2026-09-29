# ADR 0015: Os geradores formatam em memória, com a config do caminho de destino, antes de tocar na saída

## Contexto

- **A ADR 0011 deixou dois limites.** Os geradores formatavam pelo CLI do Prettier, com `--ignore-path=` e a conferência do relatório por arquivo ([ADR 0011](0011-generators-format-without-ignore-files.md)). Ela registrou dois limites e deixou os dois para a #29:
  - o `--check` formatava a cópia em `.codegen-tmp/src/…`, e não em `src/`;
  - o modo de gerar apagava a pasta e gravava o texto cru antes de formatar.
- **Medido na #29, sobre `d50fd00`**, com Python 3.9.6, Node 24.14.0 e Prettier 3.9.6:
  - com um `overrides` para `src/**/*.ts` no `.prettierrc`, um `src/.prettierrc` ou um `src/.editorconfig`, gerar saía com 0, o `--check` logo depois saía com 1 ("3 missing or changed") e o `prettier --check` dos mesmos arquivos saía com 0. Gerar e o `format:check` concordavam, e só o `--check` formatava diferente, porque o Prettier resolve a config pelo caminho do arquivo;
  - com um `.prettierrc` inválido e `--target identity`, os três geradores saíam com 2, e o `definitions` e o `resources` deixavam 3 arquivos cada regravados sem formatação;
  - com o `.prettierrc` inválido só em `src/user-management/` e todos os alvos, o `definitions` mudava 13 arquivos, o `resources` 3 e o `factories` 6, porque cada alvo gravava antes de o próximo formatar.
- **A resolução do Node sobe de pasta.** Um `import('prettier')` numa pasta sem `node_modules` acha o de uma pasta acima (medido na #29). Num worktree sem `npm ci` dentro de `.claude/worktrees/`, isso seria o Prettier do checkout principal.

## Decisão

- **O formatador é `scripts/format-generated.mjs`.** Ele lê do stdin uma lista JSON de `{ path, content }` e devolve no stdout os textos formatados, na mesma ordem. Cada texto sai de `prettier.format()` com as opções de `prettier.resolveConfig(<caminho de destino>, { editorconfig: true })`, o `filepath` de destino, `requirePragma: false` e o range do arquivo inteiro (`scripts/format-generated.mjs:55-73`). Ele importa o Prettier de `<raiz>/node_modules/prettier/index.mjs` pelo caminho (`:27-43`).
- **O gerador formata tudo antes de tocar em qualquer pasta.** Cada gerador monta um `Output` por pasta de saída, com a pasta, os arquivos, o rótulo e o cabeçalho, e chama o `write_or_check_outputs()` uma vez (`scripts/marketo_codegen.py:355-416`). O `format_files()` chama o formatador uma vez para a execução inteira e confere que voltou um texto por arquivo (`:310-352`). Só então:
  - o `write_outputs()` recusa as pastas avulsas com arquivos alheios, apaga as pastas e grava o texto formatado (`:372-390`);
  - o `check_outputs()` compara cada arquivo commitado com esse mesmo texto (`:393-411`).
- **O que fica da ADR 0011:**
  - nenhum arquivo de ignore alcança a saída: a API do Prettier nunca lê o `.gitignore` nem o `.prettierignore`;
  - o `requirePragma` e o range são forçados, então nenhuma config faz o Prettier devolver um texto sem formatar;
  - a saída 2 quer dizer "não consegui formatar", e a 1, defasado;
  - o node vem do `NODE_BIN`, do `PATH`, de `~/.nvm`, de `/usr/local/bin` ou de `/opt/homebrew/bin` (`_node_environment()`, `scripts/marketo_codegen.py:268-291`).
- **O que sai:**
  - o CLI do Prettier e as flags dele;
  - a conferência do relatório por arquivo, porque a API devolve um texto por arquivo ou falha;
  - a limpeza das variáveis `PRETTIER_*`, que só mudam o CLI;
  - o `.codegen-tmp` e a linha dele no `.gitignore`.
- **O `prettier_environment()` confere o que o formatador importa**: `node_modules/prettier/index.mjs` e um node (`scripts/marketo_codegen.py:294-307`). Sem eles, o gerador sai com 2 antes de chamar o formatador.

## Racional

- **A config do destino é a que vale.** O `format:check` lê a config de `src/`, então a saída gerada precisa ser formatada como se já estivesse lá. Formatar em memória com o `filepath` de destino faz gerar, o `--check` e o `format:check` darem o mesmo texto, sem cópia em outro caminho. Medido: com as três configs acima, os três saem com 0.
- **Nada é apagado antes de tudo estar formatado.** Com o texto formatado em memória, uma falha do Prettier para a execução antes do primeiro `rmtree`. Medido: com o `.prettierrc` inválido, na raiz ou só numa área, os três geradores saem com 2 e nenhum arquivo de `src/` muda.
- **Um processo por gerador.** O formatador abre um node por execução, não um por alvo. O `generate:all` caiu de 10,4 s para 4,1 s e o `check:all` de 9,9 s para 3,8 s, com os 1.088 arquivos iguais aos que o CLI formatava.
- **O Prettier pelo caminho.** A resolução do Node subiria até um `node_modules` de fora da raiz, e um gerador rodado num worktree sem `npm ci` formataria com outra instalação. O `codegen.spec.ts` prova que uma árvore sem `node_modules`, dentro de uma pasta que tem um, sai com 2.
- **O custo que a ADR 0011 recusou agora compra algo.** Ela recusou a API por ser "um arquivo e um contrato Python-Node a mais para manter". Desde a #29, a API é o único caminho medido que resolve os dois limites juntos.

## Alternativas consideradas

| Opção | Por que não |
| --- | --- |
| Manter o CLI e formatar os dois modos em `.codegen-tmp`, movendo para `src/` no fim | Resolve a falha no modo de gerar, e gerar passa a concordar com o `--check`. Mas, com uma config que dependa do caminho, a saída gerada passa a discordar do `format:check`, e o vermelho só muda de lugar. O dono escolheu a API (pergunta 1 do plano da #29) |
| O CLI com `--stdin-filepath`, um processo por arquivo | Dá a config do destino, mas abre um node por arquivo, para 1.088 arquivos |
| Formatar e comparar dentro de `src/`, com a pasta commitada guardada e devolvida no fim | Um gerador interrompido deixaria `src/` trocado, e duas execuções na mesma árvore se atropelariam |
| Recusar uma config que dependa do caminho | Detectar isso já pede a API, e o repositório perderia uma config legítima |
| Formatar alvo por alvo, cada um antes de gravar | Uma falha num alvo encontraria os anteriores já regravados. A primeira versão do protótipo da #29 fazia assim |

## Consequências

- **Mais fácil**:
  - qualquer config do Prettier que o `format:check` aceite vale também para a saída gerada;
  - uma falha do Prettier ou do node não toca nenhuma pasta, e não há mais o que desfazer;
  - os geradores ficam duas vezes mais rápidos, com um node por execução.
- **Mais difícil**:
  - **o contrato Python-Node.** O `format_files()` e o `scripts/format-generated.mjs` precisam concordar no JSON. Uma falha do formatador sai com 2, e o `codegen.spec.ts` o exercita pelos três geradores;
  - **a API do Prettier entra no contrato.** O `resolveConfig()` e o `format()` são a API pública do Prettier 3, travado no lock. Um upgrade que mude a formatação muda o CLI e a API juntos, e o `check:all` o acusa;
  - **uma config com plugins não foi medida.** O repositório não tem nenhuma;
  - **uma regra sobre `src/` num `.prettierignore`** ainda tira os arquivos gerados do `format:check`, que usa o CLI, mas não do `check:all`.

## Relacionados

- [ADR 0011: Os geradores formatam sem arquivo de ignore e falham quando não formatam](0011-generators-format-without-ignore-files.md), que esta decisão substitui
- [ADR 0004: O Swagger como fonte única, com o código gerado commitado](0004-swagger-as-single-source-with-committed-generated-code.md)
- [ADR 0008: A toolchain](0008-toolchain.md), com o Prettier e o Python dos geradores
- [Bug: Os geradores formatam fora do caminho de destino e gravam antes de formatar](../intent/bug-generators-format-by-destination-path.md)
- [Pattern: Gerar e conferir](../knowledge/patterns/generate-and-check.md)
- [Anti-pattern: Confiar que a ferramenta processou o arquivo passado pelo nome](../knowledge/anti-patterns/trusting-a-tool-to-process-a-named-file.md)

## Status

- **Criado**: 2026-09-29 (Fase: Build), da pergunta 1 do plano vigente da #29, respondida no Approve do dono (#29)
- **Status**: Accepted
