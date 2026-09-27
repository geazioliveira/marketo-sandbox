# Anti-pattern: Mensagem de commit que diz menos do que o commit faz

## Resumo

Uma mensagem de commit que descreve só parte do diff, ou outra coisa, esconde o resto de quem lê o histórico ou revisa pela mensagem.

## Problema

Quatro dos nove commits anteriores ao loop dizem menos, ou outra coisa, do que fazem:

| Commit | A mensagem diz | O commit faz |
| --- | --- | --- |
| `a967f26` | "Refactor Marketo generation scripts to improve structure and readability; update file handling and output logic" | Muda o comportamento do que o gerador de resources emite, não só a "output logic": os services passam de `NotImplementedException` a factories, e os módulos ganham `exports: [Service]` (`a967f26:scripts/generate-marketo-resources.py:189` e `:236`). Os imports emitidos perdem o sufixo `.js`. Os dois geradores passam a importar `marketo_codegen`, que só chega em `0ef242d`, e não rodam até lá: medido na #4, saem com `ModuleNotFoundError` em `a967f26` e em `5cc5e09` |
| `a19d9d3` | "Remove unused DTO interfaces and types to clean up the codebase" | Apaga 101 DTOs de `src/asset-definitions/`. Eles não eram sem uso: os mesmos 101 caminhos voltam no commit seguinte. É metade de um movimento |
| `e7a0bb6` | "Add new DTO interfaces for multipart files, flow steps, file folders, and email templates; refactor existing DTOs for consistency" | Não traz tipo novo: são 255 DTOs antes e os mesmos 255 nomes depois. Move todos para `src/asset/asset-definitions/` (154 renomeados, com similaridade de 50% a 90%, e os 101 de volta) e reformata os 255 no estilo do `.prettierrc`: aspas simples e sem ponto e vírgula (`.prettierrc:2` e `:4`) |
| `5cc5e09` | "Export services from module files to improve module accessibility" | Além do `exports` nos 23 módulos, troca o prefixo dos imports dos 23 controllers e troca os stubs `NotImplementedException` dos 23 services por chamadas às factories, que só chegam em `b91681a` |

- **Em escala menor, mais dois.** `01ee283` ("Add scripts for generating and checking Marketo assets…") só acrescenta scripts npm, e o `generate:factories` aponta para um gerador que só chega em `0ef242d`; o commit também move o `@faker-js/faker` para `dependencies`, acrescenta o `@nestjs/swagger` e liga `ignoreDeprecations: "6.0"` no `tsconfig.json`. `fb4a804` ("Set up Swagger documentation and seed mock data…") também troca o `await bootstrap()` de topo por `bootstrap()`, a mudança que faz o `tsc` passar pela primeira vez (medido na #4).
- **O que se perde.** O commit em que os services deixaram de lançar `NotImplementedException` e passaram a devolver factories aparece no histórico como "export services". Quem lê só `a19d9d3` conclui que 101 DTOs sobravam. E reverter só `e7a0bb6` devolveria 154 DTOs à pasta antiga, sem os outros 101.
- **Nada no processo mostrou isso.** Os nove commits entraram direto em `main`, sem issue e sem PR, e a [ADR 0001](../../decisions/0001-context-mesh-in-the-repository.md) cita `5cc5e09` como o commit que fez mais do que a mensagem dizia.
- **O custo chegou depois.** Sem o registro, quem chega não separa decisão de acidente. A #4 precisou reconstruir cada um desses commits pelo diff para registrá-los ([Registro retroativo do projeto](../../intent/feature-retroactive-record.md)).

## O que fazer em vez disso

- **Uma mudança por commit, e a mensagem diz tudo o que ele faz.** Comece pela mudança de comportamento, se houver. Um movimento diz que move, e uma reformatação vai num commit dela ([Mover as pastas geradas sem o gerador](moving-generated-folders-without-the-generator.md)).
- **"Refactor" só quando nada muda** no comportamento nem na saída gerada.
- **Antes do push, leia o diff contra a mensagem** (`git show --stat`). Se o diff faz mais, divida o commit ou reescreva a mensagem. Os commits da branch entram em `main` como foram feitos, pelo merge commit ([ADR 0001](../../decisions/0001-context-mesh-in-the-repository.md)).
- **Cada mensagem termina com `Refs #N`** (`docs/development/workflow.md:19`). A issue guarda o plano que o commit executa ([Ciclo de vida de issue e branch](../patterns/issue-branch-lifecycle.md)).
- **A revisão lê o diff, não a mensagem** ([Revisão antes do merge](../patterns/review-before-merge.md)).

## Exemplo do erro

```text
a19d9d3 Remove unused DTO interfaces and types to clean up the codebase
 101 files changed, 1046 deletions(-)
e7a0bb6 Add new DTO interfaces for multipart files, flow steps, file folders, and email templates; refactor existing DTOs for consistency
 255 files changed, 2127 insertions(+), 985 deletions(-)
```

Os 101 arquivos que o primeiro apaga são os 101 que o segundo adiciona, com os mesmos caminhos relativos.

## Status

- **Criado**: 2026-09-25 (Fase: Build), registro retroativo de `0c8e760`..`fb4a804` (#4)
- **Status**: Active
- **Atualizado**: 2026-09-26 (Fase: Build), a citação do gerador de `a967f26` passou a levar o prefixo do commit (#7)
