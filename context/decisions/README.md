# Registros de decisão (ADR)

Uma escolha relevante por arquivo. Nome, template e vocabulário de status estão no [guia do Context Mesh](../README.md).

- **Numeração.** Quatro dígitos, `NNNN-<slug>.md`, a partir da maior que existe. Um número nunca é reaproveitado, nem quando a decisão vira `Superseded` ou `Deprecated`.
- **Respeitar ou reabrir.** Toda decisão registrada aqui vale até que uma decisão posterior a substitua. Antes de trabalhar numa área, leia as decisões que tocam nela. Uma mudança que contradiz uma decisão diz isso no plano da issue e a reabre com uma decisão nova, em vez de passar por cima dela em silêncio.
- **Índice em dia.** A PR que muda o status de uma decisão atualiza a linha dela nesta tabela, no mesmo commit.

| Decisão | Título | Status |
| --- | --- | --- |
| [0001](0001-context-mesh-in-the-repository.md) | Context Mesh no repositório e loop issue-first | Accepted |
| [0002](0002-soft-enforcement-on-github-free.md) | Enforcement soft do loop no GitHub Free | Accepted |
| [0003](0003-copilot-review-and-no-open-threads-before-merge.md) | Revisão do Copilot na cabeça e nenhuma thread aberta antes do merge | Accepted |
| [0004](0004-swagger-as-single-source-with-committed-generated-code.md) | O Swagger como fonte única, com o código gerado commitado | Accepted |
| [0005](0005-nestjs-express-one-module-per-tag.md) | NestJS sobre Express, com um módulo por tag | Accepted |
| [0006](0006-dtos-as-typescript-interfaces.md) | DTOs como interfaces TypeScript | Accepted |
| [0007](0007-faker-factories-with-overrides-and-seed.md) | Factories faker com overrides e seed | Accepted |
| [0008](0008-toolchain.md) | A toolchain | Accepted |
| [0009](0009-behaviour-beside-generated-code.md) | Comportamento ao lado do código gerado, nunca dentro | Proposed |
| [0010](0010-loopback-only-by-default.md) | O mock só fala com a própria máquina por padrão | Accepted |
| [0011](0011-generators-format-without-ignore-files.md) | Os geradores formatam sem arquivo de ignore e falham quando não formatam | Accepted |
| [0012](0012-swagger-source-record-per-area.md) | Cada área registra o Swagger que a gerou, com o sha256 dos bytes commitados | Accepted |
| [0013](0013-top-level-definitions-without-members-as-type-aliases.md) | Definição de topo sem membros vira alias de tipo, e a factory dela devolve o valor inteiro | Accepted |
| [0014](0014-multipart-read-by-a-hand-written-interceptor.md) | O corpo multipart lido num interceptor escrito à mão | Accepted |

As decisões de 0004 a 0009 são o registro retroativo dos commits anteriores ao loop (#4). O racional que o histórico não registra está marcado "(inferido; confirmar)". A 0009 fica `Proposed` até a primeira sub-issue da Track A que construir comportamento.
