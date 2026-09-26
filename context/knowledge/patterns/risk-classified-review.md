# Pattern: Revisão classificada por risco

## Resumo

Todo plano de issue e toda PR declaram o risco, `HIGH` ou `NORMAL`, com o raciocínio, e o risco decide o quanto a revisão lê antes do merge.

## Problema

- Os dois forms de issue e o template de PR pedem o risco, `HIGH` ou `NORMAL`, e o raciocínio (`.github/ISSUE_TEMPLATE/feature.yml:76-83`, `.github/ISSUE_TEMPLATE/bug.yml:86-93`, `.github/pull_request_template.md:10-12`). O form de funcionalidade e o template dizem que o risco decide a profundidade da revisão, e o passo 8 do loop diz o mesmo ([o loop](../../../docs/development/workflow.md#o-loop)).
- Até este pattern, só uma regra dizia o que é HIGH: uma PR que toca `.github/workflows/**` ([Pull requests e merge](../../../docs/development/workflow.md#pull-requests-e-merge), [ADR 0002](../../decisions/0002-soft-enforcement-on-github-free.md)). Nada dizia o que HIGH pede a mais.
- Nenhum script lê o token. O gate só exige que a seção Riscos (ou Risco) exista e não esteja vazia (`scripts/loop-sections.mjs:95-98,124,135,398-401`). A classificação é conferida na leitura.
- As PRs do harness mostram o que uma revisão mais funda acha:
  - na #2, três rodadas de revisão e verificação adversariais acharam mais de 30 defeitos reais e distintos num gate que já passava em todos os testes ([changelog](../../evolution/changelog.md));
  - uma revisão adversarial da #3 achou o limite da auditoria tirado do evento ([anti-pattern](../anti-patterns/audit-bound-from-the-event.md)).
- Um erro no contrato ou no código gerado chega ao lite-campaign, que consome o mock ([AGENTS.md](../../../AGENTS.md)) e, pela visão do [project intent](../../intent/project-intent.md), roda contra ele os testes de ponta a ponta.

## Solução

### Onde o risco é declarado

- **No plano da issue**, na seção `Riscos` (ou `Risco`), obrigatória nos dois forms. A primeira palavra é o token, `HIGH` ou `NORMAL`, em inglês ([Idioma e tokens](../../README.md#idioma-e-tokens)). Depois vêm o raciocínio e, para cada risco, a mitigação, como nos planos da #2, da #3, da #12 e da #13.
- **Na PR**, na seção `Risco` do template, que repete o risco do plano. A PR sobe para HIGH quando toca algo da lista abaixo, seja qual for o risco do plano, como já vale para `.github/workflows/**`.

### O que é HIGH

Uma mudança é HIGH quando toca pelo menos um destes:

- **O contrato Swagger e o envelope.** `docs/marketo-swagger-asset.json` ([ADR 0004](../../decisions/0004-swagger-as-single-source-with-committed-generated-code.md)) e o envelope `{errors, requestId, result, success, warnings}` das respostas `ResponseOf*`, com os valores fixos de `ENVELOPE_VALUES` (`scripts/generate-marketo-factories.py:30-36`).
- **O código gerado.** `src/asset/asset-definitions/`, `src/asset/resources/` e `src/asset/asset-mocks/` ([a fronteira do código gerado](generated-code-boundary.md)).
- **Os geradores.** `scripts/*.py` ([gerar e conferir](generate-and-check.md)).
- **O CI.** `.github/workflows/**`. O `check.yml` roda o YAML da própria PR, que consegue afrouxá-lo ([ADR 0002](../../decisions/0002-soft-enforcement-on-github-free.md)).
- **O harness.**
  - o gate e os contratos do loop (`scripts/gate.mjs`, `scripts/loop-sections.mjs`);
  - a auditoria de `main` e o refresh (`scripts/audit-main.mjs`, `scripts/refresh-issue-link.mjs`);
  - o tooling do contexto (`scripts/check-context.mjs`);
  - os forms e o template de PR (`.github/ISSUE_TEMPLATE/`, `.github/pull_request_template.md`);
  - os hooks do Claude Code (`.claude/hooks/`, #5);
  - os testes de tudo isso, em `test/scripts/` (inferido; confirmar).
- **Tudo o que o lite-campaign consome.** As rotas e os métodos, o formato das respostas, o seed e a data de referência (`MARKETO_MOCK_SEED`, `MARKETO_MOCK_REF_DATE`), a porta (`PORT`, 3000 por padrão, `src/main.ts:21`) e, quando existirem, a release com tag e o comando que a sobe ([project intent](../../intent/project-intent.md)).

As issues já seguem isso. A #7 é HIGH porque mexe nos geradores e em toda a saída gerada, e a #8, porque muda o roteamento que os consumidores usam. A #2, a #3, a #5, a #12 e a #13, do harness, também são HIGH.

### O que é NORMAL

- Tudo o que não toca a lista acima: `context/`, `docs/` fora o Swagger, `README.md`, `AGENTS.md` e o código escrito à mão que não muda o que um consumidor vê. O plano da #4, que só registrava documentação, era NORMAL. A PR dela subiu para HIGH porque mudou um teste de drift em `test/scripts/`.
- Na dúvida entre os dois, é HIGH (inferido; confirmar).

### O que cada risco pede da revisão

- **NORMAL** pede a revisão de toda PR ([revisão antes do merge](review-before-merge.md)):
  - uma revisão do Copilot na cabeça e zero threads abertas, cada uma respondida antes de resolvida;
  - o veredito fresco do gate logo antes do merge;
  - na Verificação, os checks realmente rodados, com a saída;
  - em Desvios do plano aprovado, o que saiu diferente do plano (`.github/pull_request_template.md`).
- **HIGH** pede, além disso, o que segue. Nenhum plano aprovado lista estes itens, e só a verificação adversarial já foi feita, nas PRs da #2, da #3 e da #13 (inferido; confirmar):
  - **Cada linha escrita à mão é lida**, não só a descrição, os testes e o CI. A saída regenerada é provada pelo `check:*`, não lida linha a linha ([gerar e conferir](generate-and-check.md)).
  - **Uma verificação adversarial.** Uma rodada tenta quebrar a mudança: um caso legítimo que ela bloqueia, um desvio que ela deixa passar, uma mudança no que o consumidor vê. Outra rodada verifica as correções. As PRs da #2 e da #3 fizeram isso, e a da #13 também passou por uma verificação adversarial das últimas correções (#1).
  - **Uma mitigação por risco**, nomeada no plano e na PR, e a revisão confere cada uma.
  - **A prova do contrato.** Numa mudança no código gerado, a saída do `check:*` vai na Verificação; hoje o `check:all` não passa (#7). Numa mudança no que o lite-campaign consome, a PR diz o que muda para ele.
  - **A leitura do dono antes do merge** (inferido; confirmar). Hoje a autorização permanente de merge da #2 não distingue risco ([Pull requests e merge](../../../docs/development/workflow.md#pull-requests-e-merge)), e esta regra a restringiria nas PRs HIGH.

## Quando usar

- Ao escrever a seção Riscos de todo plano de issue, feature ou bug, e a seção Risco de toda PR.
- Ao revisar uma PR: o risco declarado decide o que ler, e a lista acima confere se ele está certo.

## Quando NÃO usar

- Num relato sem plano (`needs-triage`), que o gate ainda não lê. Os forms já pedem o risco no relato (`.github/ISSUE_TEMPLATE/feature.yml:76-83`, `.github/ISSUE_TEMPLATE/bug.yml:86-93`), mas a #6 e a #9 não o dão, e a #7 e a #8 já o dão. O gate o exige quando o plano chega.
- Para dispensar a revisão: NORMAL ainda passa por toda a [revisão antes do merge](review-before-merge.md).
- Na issue de acompanhamento (#1), que dá o risco de cada sub-issue na tabela do plano e não tem PR.

## Decisões relacionadas

- [0002: Enforcement soft do loop no GitHub Free](../../decisions/0002-soft-enforcement-on-github-free.md)
- [0003: Revisão do Copilot na cabeça e nenhuma thread aberta antes do merge](../../decisions/0003-copilot-review-and-no-open-threads-before-merge.md)
- [0004: O Swagger como fonte única, com o código gerado commitado](../../decisions/0004-swagger-as-single-source-with-committed-generated-code.md)

## Status

- **Criado**: 2026-09-25 (Fase: Build), do que o loop das #2, #3 e #13 já pratica, registrado na #4 (#4)
- **Status**: Active
- **Atualizado**: 2026-09-26 (Fase: Build), os hooks do Claude Code entraram na lista do harness como existentes (#5)
