# Padrões de código

As regras vivem no Context Mesh. Esta página só aponta para elas.

## Patterns

- [A forma de um módulo de recurso](context/knowledge/patterns/resource-module-shape.md)
- [A fronteira do código gerado](context/knowledge/patterns/generated-code-boundary.md)
- [Ciclo de vida de issue e branch](context/knowledge/patterns/issue-branch-lifecycle.md)
- [Corpus de comandos reais](context/knowledge/patterns/real-command-corpus.md)
- [Factory com overrides](context/knowledge/patterns/factory-with-overrides.md)
- [Gerar e conferir](context/knowledge/patterns/generate-and-check.md)
- [O gate do loop](context/knowledge/patterns/loop-gate.md)
- [Revisão antes do merge](context/knowledge/patterns/review-before-merge.md)
- [Revisão classificada por risco](context/knowledge/patterns/risk-classified-review.md)
- [Timeouts de testes que disparam processos](context/knowledge/patterns/process-test-timeouts.md)

## Anti-patterns

- [Check que espera um evento que não chega](context/knowledge/anti-patterns/check-waiting-for-an-event-that-never-comes.md)
- [Check que só compara a saída derivada](context/knowledge/anti-patterns/check-that-only-compares-derived-output.md)
- [Confiar que a ferramenta processou o arquivo passado pelo nome](context/knowledge/anti-patterns/trusting-a-tool-to-process-a-named-file.md)
- [Dublê de teste estrito na camada errada](context/knowledge/anti-patterns/test-double-strict-on-the-wrong-layer.md)
- [Editar código gerado à mão](context/knowledge/anti-patterns/hand-editing-generated-code.md)
- [Guarda que só reconhece o nome literal](context/knowledge/anti-patterns/guard-by-literal-name.md)
- [Limite da auditoria tirado do evento](context/knowledge/anti-patterns/audit-bound-from-the-event.md)
- [Mensagem de commit que diz menos do que o commit faz](context/knowledge/anti-patterns/commit-message-understating-its-content.md)
- [Mergear com uma re-execução do check em andamento](context/knowledge/anti-patterns/merge-with-a-run-in-flight.md)
- [Middleware do Nest para todas as rotas, que vira uma rota](context/knowledge/anti-patterns/nest-middleware-as-a-catch-all-route.md)
- [Mover as pastas geradas sem o gerador](context/knowledge/anti-patterns/moving-generated-folders-without-the-generator.md)
- [Padrão com `??` para uma variável de ambiente](context/knowledge/anti-patterns/nullish-default-for-an-env-var.md)
- [Regra de formato escrita só na prosa do guia](context/knowledge/anti-patterns/format-rule-only-in-prose.md)
- [Rota literal declarada depois de uma rota com parâmetro](context/knowledge/anti-patterns/literal-route-after-param-route.md)
- [Uma porta efêmera nova a cada requisição do supertest](context/knowledge/anti-patterns/a-new-ephemeral-port-per-supertest-request.md)
- [Uma PR que prende partes independentes](context/knowledge/anti-patterns/one-pr-for-many-independent-parts.md)
