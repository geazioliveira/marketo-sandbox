# ADR 0012: Cada área registra o Swagger que a gerou, com o sha256 dos bytes commitados

## Contexto

- **O critério sem prova.** O [project intent](../intent/project-intent.md) pede que o mock registre qual cópia do Swagger o gerou, com o sha256. Até a #19, o sha256 de cada documento só estava na tabela da [ADR 0004](0004-swagger-as-single-source-with-committed-generated-code.md) e no changelog, e o cabeçalho de gerado cita o documento, não a cópia.
- **O furo, medido na #19 sobre `e5b013c`.** Com um `\n` a mais no fim de `docs/marketo-swagger-asset.json`, o `npm run check:all` saía com 0 e imprimia as 16 linhas "are current". Nenhum gerador lê o `info` nem o espaço entre os tokens, então uma mudança assim não mudava nenhum arquivo gerado, e a tabela da ADR 0004 envelhecia em silêncio.
- **As quebras de linha.** Quatro documentos estão no índice com LF, e `docs/marketo-swagger-user.json` com CRLF, como veio da Adobe. Medido no planejamento da #19: num checkout `core.autocrlf=true`, o sha256 dos quatro documentos LF muda (asset vira `9269d0fc…`), e o do user não. O `check:all` não via isso porque nenhum arquivo gerado dependia dos bytes do documento: o `json.loads` ignora o espaço entre os tokens. O `read_text()` do `check_output()` só explica por que os `.ts` gerados, regravados com CRLF, também passavam.
- **A decisão em aberto depende disso.** A escolha entre a cópia de assets daqui (`ced6c339…`) e a do lite-campaign (`ff7ec628…`) sai de um diff nas rotas que o consumidor usa, e o diff só vale se o mock disser qual cópia gerou cada versão.

## Decisão

- **Um registro por área.** O gerador de definições emite `src/<área>/<área>-definitions/swagger-source.ts`, com o cabeçalho de gerado e `export const swaggerSource = { document, sha256 } as const` (`swagger_source()`, `scripts/generate-marketo-definitions.py:145-154`). O `document` é escrito como o cabeçalho o escreve, pelo `document_path()` (`scripts/marketo_codegen.py:220-231`); fora do repositório, só o nome do arquivo.
- **O sha256 dos bytes como estão.** O hash sai de `target.source.read_bytes()`, sem normalizar as quebras: o sha256 registrado é o mesmo do `shasum -a 256` do arquivo commitado.
- **Os bytes fixados em todo checkout.** O `.gitattributes` tem `docs/marketo-swagger-*.json -text`: nenhum documento Swagger passa por conversão de fim de linha, com ou sem `core.autocrlf`.
- **O `check:all` confere o registro** como qualquer arquivo gerado. Um documento mudado sem regenerar deixa o registro da área defasado, e o `check:definitions` sai com 1 citando `swagger-source.ts`.
- **Só no código, não em runtime.** Resposta do dono à pergunta 1 do plano da #19: o registro fica em `src/` e no `dist/`, e um consumidor o lê na tag que fixar. Nenhuma rota, header ou resposta muda.
- **A tabela da ADR 0004 vira a origem medida na #6.** O sha256 vigente de cada área é o do registro dela.

## Racional

- **Um arquivo por área muda só quando o documento muda.** Trocar uma descrição do Swagger de assets muda o documento, o arquivo gerado daquela descrição e o registro: 3 arquivos (medido no planejamento).
- **A regra `-text` é a única que mantém os cinco sha256 sem esconder o diff.** O `binary` também os mantém, mas esconde o diff do Swagger na revisão. Medido no planejamento: com `-text`, um checkout `core.autocrlf=true` mantém os cinco; com `text eol=lf`, o `git status` dá o user como modificado, porque o índice dele tem CRLF.
- **O registro onde o gerador já escreve.** A raiz de `<área>-definitions/` não tinha arquivo nenhum, então o registro não colide com schema nenhum, e o `write_output()` e o `check_output()` já cuidam dele sem código novo.
- **Sem runtime por ora.** Expor o registro em `/api-json` pediria um módulo escrito à mão com uma linha por área, tiraria a montagem da Swagger UI do `bootstrap()` e faria um consumidor depender do `/api-json`. O esquema de release e tag, que diria onde ler o registro, ainda está em aberto no project intent.

## Alternativas consideradas

| Opção | Por que não |
| --- | --- |
| O sha256 no cabeçalho de todo arquivo gerado | Trocar uma descrição do Swagger de assets mudaria 583 arquivos em vez de 3 (medido no planejamento, no corpo da #19), e o diff esconderia a mudança de verdade |
| Um manifesto único com as cinco áreas | Um `--target` reescreveria a linha de uma área que não regenerou, ou teria de ler e mesclar o manifesto, e o `check_output()` compara pasta por pasta |
| Normalizar as quebras antes do hash | O sha256 do user deixaria de ser o do `shasum -a 256` do arquivo commitado e o do blob da Adobe |
| `binary` no `.gitattributes` | Também fixa os bytes, mas esconde o diff do Swagger na revisão |
| `text eol=lf` no `.gitattributes` | O user, com CRLF no índice, passaria a aparecer modificado no `git status` |
| O registro no `/api-json` servido pelo mock | Custo acima; fica para quando o esquema de release e tag for decidido |

## Consequências

- **Mais fácil**:
  - o código de uma versão diz qual cópia de cada Swagger o gerou, e o diff entre duas versões mostra a troca de cópia;
  - o `check:all` pega um Swagger mudado e não regenerado, e o `test/scripts/codegen.spec.ts` prova isso e o checkout CRLF.
- **Mais difícil**:
  - toda mudança num Swagger pede regenerar, até a de um espaço. `npm run generate:all` resolve;
  - um checkout antigo, com os documentos já gravados com CRLF, passa a mostrar os quatro documentos LF como modificados quando a regra chega; `git checkout -- docs/` os devolve aos bytes commitados;
  - a contagem do check inclui o registro: "All 256 asset TypeScript definitions are current." para 255 schemas;
  - um documento novo precisa se chamar `docs/marketo-swagger-<nome>.json` para a regra do `.gitattributes` pegá-lo, e o teste falha se um alvo de `TARGETS` ficar fora dela;
  - um mock já no ar não diz qual cópia o gerou.

## Relacionados

- [ADR 0004: O Swagger como fonte única, com o código gerado commitado](0004-swagger-as-single-source-with-committed-generated-code.md)
- [ADR 0006: DTOs como interfaces TypeScript](0006-dtos-as-typescript-interfaces.md), a pasta onde o registro fica
- [Pattern: Gerar e conferir](../knowledge/patterns/generate-and-check.md)
- [Pattern: A fronteira do código gerado](../knowledge/patterns/generated-code-boundary.md)
- [Feature: O registro do Swagger que gerou cada área, com sha256](../intent/feature-swagger-source-sha256.md)

## Status

- **Criado**: 2026-09-28 (Fase: Build), do plano vigente da #19, com a pergunta 1 respondida no Approve do dono (#19)
- **Status**: Accepted
