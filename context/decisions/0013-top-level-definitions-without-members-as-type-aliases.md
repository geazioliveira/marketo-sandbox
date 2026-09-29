# ADR 0013: Definição de topo sem membros vira alias de tipo, e a factory dela devolve o valor inteiro

## Contexto

- **A ADR 0006 diz que todo DTO é uma `export interface`** ([ADR 0006](0006-dtos-as-typescript-interfaces.md)), e a ADR 0007, que toda factory é `makeX(overrides: Partial<X> = {})` e espalha `...overrides` sobre um objeto ([ADR 0007](0007-faker-factories-with-overrides-and-seed.md)). As duas supõem que toda definição é um objeto com membros.
- **Nove definições dos cinco documentos não têm `properties` nem `allOf`.** Medido em `e5b013c`, três delas pedem outra forma:
  - `LeadAttribute2SearchableFields`, de Lead Database, é `{type: array, items: string}` (`docs/marketo-swagger-mapi.json:7381`). Saía como `export interface LeadAttribute2SearchableFields {}`, e a factory devolvia `{}`. Por isso `GET /rest/v1/leads/describe2.json` e `GET /rest/v1/programs/members/describe.json` respondiam `searchableFields: [{}, …]`, e o documento diz um array de arrays de string.
  - `Person` e `CustomObject`, de Data Ingestion, são objetos só com `additionalProperties: true`. Saíam como `export interface X {}`. Os dois só aparecem em requisições.
- **As outras seis continuam interfaces vazias**, e com razão: não declaram forma nenhuma além de objeto. `Empty`, de Lead Database, não declara nem `type`. Cinco são só `{type: object}`: `ModelResponse` e `MultipartFile`, de assets, e `InputStream`, `ObservableOfInputStreamContent` e `ObservableOfInputStreamRangeContent`, de Lead Database.

## Decisão

- **Uma definição de topo sem membros vira `export type X = …`.** Sem membros quer dizer: sem `properties` e sem `allOf`, e com um `type` que não é `object`, ou um objeto só com `additionalProperties` (`is_type_alias()`, `scripts/marketo_codegen.py:200-212`). O lado direito sai do mesmo `type_name()` das propriedades (`render_alias()`, `scripts/generate-marketo-definitions.py:142-154`):
  - `LeadAttribute2SearchableFields` é `Array<string>`;
  - `Person` e `CustomObject` são `Record<string, unknown>`.
- **A factory de uma definição que não é objeto devolve o valor inteiro**, e o override troca o valor inteiro: `makeX(override?: X): X`, com `return override ?? <valor>` (`render_value()`, `scripts/generate-marketo-factories.py:184-210`). A de `LeadAttribute2SearchableFields` devolve de 1 a 3 palavras do faker.
- **A factory de `Person` e de `CustomObject` não muda.** Com o alias `Record<string, unknown>`, `Partial<X>` e `...overrides` continuam valendo, e ela devolve só os overrides, `{}` por padrão.
- **O resto continua como as ADRs 0006 e 0007 dizem.** Toda definição com `properties` ou `allOf`, e a que não declara nada, segue uma `export interface` com a factory de overrides.

## Racional

- **Uma interface não descreve um array.** `export interface X {}` aceita qualquer objeto, e a factory, sem membros para preencher, devolvia `{}`. O tipo e o mock contradiziam o documento sem que o `check:all` nem o e2e da #6 notassem.
- **O alias reaproveita a regra das propriedades.** Uma propriedade `{type: array, items: string}` já saía como `Array<string>`. Uma definição de topo igual sai igual, e nenhuma forma nova entra no gerador.
- **O override troca o valor porque não há campo a trocar.** Um array não tem membros que um `Partial` possa fixar um a um, e o merge da ADR 0007 já é raso: um override de uma propriedade troca a propriedade inteira.
- **`Person` e `CustomObject` entram pela mesma regra.** A ADR 0006 já os atribuía à #24, e o dono aprovou incluí-los (pergunta 4 do plano da #24). O alias diz o que o documento diz: um mapa aberto.

## Alternativas consideradas

| Opção | Por que não |
| --- | --- |
| Uma interface que estende `Array<string>` | Uma interface assim tipa, mas a factory precisaria de outra forma de qualquer jeito, e ninguém lê `interface X extends Array<string> {}` como um array |
| Inlinar a definição em quem a usa, sem arquivo próprio | Quebra a regra de um arquivo por definição, e um `$ref` para ela deixaria de ter um alvo ([ADR 0004](0004-swagger-as-single-source-with-committed-generated-code.md)) |
| Manter `Partial<X>` e `...overrides` na factory do array | Espalhar `...overrides` num array dentro de um objeto devolve um objeto, que é o defeito da #24 |

## Consequências

- **Mais fácil**:
  - o tipo e o mock de uma definição sem membros seguem o documento, e o `test/response-schema.e2e-spec.ts` confere cada resposta contra o schema documentado;
  - uma definição nova que seja um array, um primitivo ou um objeto só com `additionalProperties: true` sai certa sem mudar o gerador.
- **Mais difícil**:
  - **duas formas de DTO e duas de factory.** Quem lê uma definição precisa ver se ela é interface ou alias, e quem chama uma factory, se ela recebe `Partial<X>` ou o valor inteiro;
  - **o override de um array não é parcial.** Para mudar um item, passe o array inteiro;
  - **duas formas que nenhum documento usa hoje ainda sairiam erradas**, achadas pela verificação adversarial da #24 numa área sintética. Um objeto de topo só com `additionalProperties: {$ref: Item}` vira `Record<string, Item>`, mas a factory de overrides não compila (TS2322). E uma resposta 2xx que é um `$ref` para uma definição primitiva sairia como `text/html`, porque só a resposta primitiva inline é mandada como JSON. O `tsc` e o `test/response-schema.e2e-spec.ts` pegariam as duas, e a correção é mandar todo alias para a factory de valor e tratar o `$ref` para um primitivo como primitivo.

## Relacionados

- [ADR 0006: DTOs como interfaces TypeScript](0006-dtos-as-typescript-interfaces.md), que esta decisão emenda
- [ADR 0007: Factories faker com overrides e seed](0007-faker-factories-with-overrides-and-seed.md), que esta decisão emenda
- [Pattern: Factory com overrides](../knowledge/patterns/factory-with-overrides.md)
- [Bug: Código gerado fora do schema e upload multipart que não chega ao handler](../intent/bug-generated-code-off-schema.md)

## Status

- **Criado**: 2026-09-28 (Fase: Build), do plano aprovado na issue #24 (#24)
- **Status**: Accepted
