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

A 0003 foi tomada pela #13. As seis decisões retroativas da #4 ficam com os próximos números livres, a partir da 0004: o Swagger como fonte única com o código gerado commitado, NestJS com um módulo por tag, DTOs como interfaces, factories faker com overrides e seed, a toolchain e o comportamento com estado ao lado do código gerado.
