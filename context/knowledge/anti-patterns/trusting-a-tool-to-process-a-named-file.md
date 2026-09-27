# Anti-pattern: Confiar que a ferramenta processou o arquivo passado pelo nome

## Resumo

Uma ferramenta que lê um arquivo de ignore por padrão pode pular, sem mensagem e com saída 0, um arquivo que foi passado pelo nome. Quem a chama desliga o ignore ou confere o que ela processou.

## Problema

- **O Prettier 3 faz isso.** Ele lê o `.gitignore` e o `.prettierignore` por padrão. No `--write` e no `-l`, pula o arquivo ignorado com saída 0 e sem mensagem; no `--check`, sai com 0 dizendo "All matched files use Prettier code style!" (Prettier 3.9.6, medido na #7). Conferir depois com `--check` ou `-l` não ajuda: eles pulam do mesmo jeito.
- **Na #6, o `.gitignore`.** A regra `/.codegen-tmp/` (`.gitignore:41`) deixava sem formatação a cópia que o `--check` dos geradores compara, e os 459 DTOs pareciam defasados. O plano da #6 atribuía isso à pasta ser oculta, e a medição achou o `.gitignore`.
- **Na #7, o `.prettierignore`.** A correção da #6 fazia o Prettier ler só o `.prettierignore`. Uma regra sem âncora, como `identity/`, fazia gerar gravar sem formatar e sair com 0, e depois os três `--check` e o `format:check` respondiam que estava tudo certo: um verde falso.
- **O sintoma engana.** O que aparece é uma defasagem que não existe, ou nenhuma quando existe, e nada aponta para a regra de ignore.

## O que fazer em vez disso

- **Desligue os arquivos de ignore na chamada**, com `--ignore-path=` no Prettier, quando a lista de arquivos já é exatamente a que precisa ser processada.
- **Confira o relatório por arquivo contra a lista passada** e pare com um código próprio se faltar algum, como `format_with_prettier` faz (`scripts/marketo_codegen.py:319-362`).
- **Fixe na chamada as opções que mudam o resultado**: `--no-color`, para o relatório não vir colorido com `CI=true`; `--no-require-pragma` e `--range-start=0 --range-end=Infinity`, para uma config não fazer a ferramenta processar sem formatar; e tire do ambiente as variáveis da própria ferramenta (`PRETTIER_*`), que mudam o que ela imprime.
- **Ponha no teste um ignore que casa o caminho** e uma ferramenta que pula, como `test/scripts/codegen.spec.ts` faz com um `.prettierignore` e com um Prettier embrulhado.

Veja a [ADR 0011](../../decisions/0011-generators-format-without-ignore-files.md).

## Exemplo do erro

```python
# Um .gitignore ou .prettierignore que case um destes caminhos faz o Prettier pulá-lo em
# silêncio, com saída 0, e o --check passa a comparar saída sem formatação.
subprocess.run([prettier, "--write", "--log-level", "warn", *paths], check=True)
```

## Status

- **Criado**: 2026-09-26 (Fase: Learn), das medições da #6 e da #7 (#7)
- **Status**: Active
