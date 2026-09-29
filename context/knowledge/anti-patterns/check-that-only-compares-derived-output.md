# Anti-pattern: Check que só compara a saída derivada

## Resumo

Um check que regenera e compara só a saída derivada deixa passar toda mudança na entrada que não muda a saída. Quando a entrada precisa estar registrada, ela vira um arquivo de saída também, com o hash dos bytes.

## Problema

- **O `check:all` fazia isso até a #19.** Ele regenera o código de cada área e o compara com o commitado. Um `\n` a mais no fim de `docs/marketo-swagger-asset.json`, ou um `info.title` trocado, não muda nenhum arquivo gerado, e o `check:all` saía com 0 e imprimia as 16 linhas "are current" (medido sobre `e5b013c`).
- **O registro ao lado envelhecia em silêncio.** O sha256 de cada documento estava na tabela da [ADR 0004](../../decisions/0004-swagger-as-single-source-with-committed-generated-code.md), e nada o conferia: o documento podia mudar, e a tabela continuaria dizendo que o código de `main` saiu da cópia antiga.
- **A comparação de texto esconde mais.** O `check_output()` lê com `read_text()`, que normaliza as quebras de linha, então nem um checkout que regravasse os documentos com CRLF mudava o veredito.

## O que fazer em vez disso

- **Faça a entrada virar saída.** O gerador emite um arquivo com o que a identifica, o caminho e o sha256 dos bytes, e o check o compara como qualquer outro. Na #19, é o `swagger-source.ts` de cada área ([ADR 0012](../../decisions/0012-swagger-source-record-per-area.md)).
- **Tire o hash dos bytes, não do texto**, e fixe os bytes em todo checkout: o `.gitattributes` com `-text` nos documentos. Normalizar antes do hash daria um sha256 que ninguém reproduz com `shasum`.
- **Ponha a mudança invisível num teste**: um `\n` a mais e um checkout `core.autocrlf=true`, como o `test/scripts/codegen.spec.ts` faz.

## Exemplo do erro

```python
# Só a saída é comparada: uma mudança no Swagger que não muda nenhum arquivo gerado
# passa, e nada diz de qual cópia do documento o código commitado saiu.
stale = [path for path, fresh in regenerated.items() if path.read_text() != fresh]
```

## Status

- **Criado**: 2026-09-28 (Fase: Learn), da medição do furo no planejamento e no Build da #19 (#19)
- **Status**: Active
