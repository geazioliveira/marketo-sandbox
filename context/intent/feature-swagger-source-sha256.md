# Feature: O registro do Swagger que gerou cada área, com sha256

## Declaração de intenção

O project intent pede que o mock registre qual cópia do Swagger o gerou, com o sha256. Hoje o sha256 de cada documento só está na tabela da [ADR 0004](../decisions/0004-swagger-as-single-source-with-committed-generated-code.md), e nada a confere: uma mudança num documento que não muda nenhum arquivo gerado, como um `\n` a mais no fim ou um `info.title` trocado, passa no `check:all`. A tabela pode envelhecer em silêncio, e nada dentro do mock diz de qual cópia saiu o código de uma versão.

Esta feature dá a cada área um registro gerado com o documento e o sha256 dos bytes dele como estão no commit, conferido pelo `check:all` como qualquer arquivo gerado. É esse registro que deixa decidir, por diff, entre a cópia de assets daqui e a do lite-campaign, a decisão em aberto do project intent.

## Critérios de aceite

- [x] Cada uma das cinco áreas tem `src/<área>/<área>-definitions/swagger-source.ts`, emitido pelo gerador de definições, com o caminho do documento e o sha256 dos bytes dele como estão no commit. O `check:all` o confere como qualquer arquivo gerado.
- [x] Mudar um documento Swagger sem regenerar faz o `check:all` falhar, mesmo quando nenhum outro arquivo gerado muda. O `test/scripts/codegen.spec.ts` prova com um `\n` a mais no documento do identity; antes, o check saía com 0.
- [x] O sha256 registrado é o mesmo num checkout com LF e com CRLF. O `.gitattributes` tira os `docs/marketo-swagger-*.json` de toda conversão de fim de linha. O `codegen.spec.ts` prova com um checkout `core.autocrlf=true`, ao lado de um controle sem a regra, e falha se o documento de um alvo de `TARGETS` ficar fora da regra ou se o registro dele não bater com os bytes do documento.
- [x] Regenerar acrescenta só os 5 registros, um segundo `npm run generate:all` não muda nada, e `npm run check`, o e2e e o gate passam.
- [x] Nenhuma rota, header ou resposta muda, e o e2e passa sem mudança.
- [x] `project-intent.md` com o critério do sha256 marcado, com os testes e o `check:all` como prova. A ADR nova, a ADR 0004, os patterns, o README, o glossário, o `AGENTS.md` e o fluxo dizem onde está o registro e como ele é conferido.

## Abordagem técnica

- **O registro.** O gerador de definições emite, na raiz de `<área>-definitions/`, um `swagger-source.ts` com o cabeçalho de gerado e `export const swaggerSource = { document, sha256 } as const`. O sha256 sai de `target.source.read_bytes()`, e o documento é escrito como o cabeçalho o escreve, pelo `document_path()` de `scripts/marketo_codegen.py`, que deixa de ser privado sem mudar nenhuma outra linha do módulo.
- **Os bytes fixados.** Um `.gitattributes` com `docs/marketo-swagger-*.json -text` tira os documentos de toda conversão de fim de linha, e o sha256 fica o mesmo num checkout com `core.autocrlf=true`. Normalizar as quebras antes do hash daria ao user, que tem CRLF no índice, um sha256 que não é o do arquivo commitado.
- **Só no código, não em runtime.** Resposta do dono à pergunta 1 do plano: o registro fica em `src/` e no `dist/`, e nenhuma rota, header ou resposta muda.
- **Os commits**, cada um com `Refs #19`: este intent; os testes vermelhos; o `.gitattributes`; o gerador; a saída regenerada, sozinha; a ADR nova e a documentação; o Learn.

## Decisões relacionadas

- [0004: O Swagger como fonte única, com o código gerado commitado](../decisions/0004-swagger-as-single-source-with-committed-generated-code.md)
- [0012: Cada área registra o Swagger que a gerou, com o sha256 dos bytes commitados](../decisions/0012-swagger-source-record-per-area.md)

## Patterns relacionados

- [Gerar e conferir](../knowledge/patterns/generate-and-check.md)
- [A fronteira do código gerado](../knowledge/patterns/generated-code-boundary.md)
- [Check que só compara a saída derivada](../knowledge/anti-patterns/check-that-only-compares-derived-output.md), anti-pattern novo

## Resultados

- **O registro.** O gerador de definições emite `swagger-source.ts` na raiz de `<área>-definitions/` das cinco áreas (`swagger_source()`, `scripts/generate-marketo-definitions.py:145-154`). Em `scripts/marketo_codegen.py`, só o nome do `document_path()` mudou, e o módulo ficou com 460 linhas.
- **A saída regenerada** acrescentou só os 5 registros, 35 linhas, e um segundo `npm run generate:all` não mudou nada. Sem eles, o `check:definitions` saía com 1 nas cinco áreas, citando cada registro.
- **O furo fechado.** Com um `\n` a mais em `docs/marketo-swagger-asset.json`, o `check:all` sai com 1 e cita `src/asset/asset-definitions/swagger-source.ts`; antes, saía com 0 e 16 linhas "are current".
- **O `.gitattributes`**, com `docs/marketo-swagger-*.json -text`. Um clone da branch com `core.autocrlf=true` fica com o status limpo, os cinco documentos em `attr/-text` e os cinco sha256 iguais aos registros.
- **Os testes.** 16 casos novos no `test/scripts/codegen.spec.ts`: 5 na árvore do identity (o registro gerado, o `\n` a mais, a área avulsa, o checkout `core.autocrlf=true` com a regra e o controle sem ela) e 11 sobre a árvore real (a lista dos alvos de `TARGETS`, o registro de cada um contra os bytes do documento e o atributo `text` de cada documento). Os 15 que dependiam do Build começaram vermelhos.
- **A documentação.** A [ADR 0012](../decisions/0012-swagger-source-record-per-area.md) registra a decisão, e a ADR 0004, a 0008, os dois patterns do código gerado, o README, o glossário, o `AGENTS.md` e o fluxo dizem onde está o registro e como ele é conferido.
- **Onde se afastou do plano.** As linhas do `workflow.md` que o plano citava (`:266` e `:277`) andaram com a #5 e a #30, e as edições foram nos mesmos bullets, hoje em `:312` e `:323`.

## Status

- **Criado**: 2026-09-28 (Fase: Intent), do plano aprovado na issue #19 (#19)
- **Status**: Completed
- **Atualizado**: 2026-09-28 (Fase: Learn), o registro das cinco áreas, o `.gitattributes`, os testes e a documentação chegaram à branch, com o `check:all` conferindo o Swagger (#19)
