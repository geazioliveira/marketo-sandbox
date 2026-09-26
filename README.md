# marketo-sandbox

A local mock of the Marketo Engage REST API, generated from Marketo's official
Swagger documentation: each documented operation becomes a NestJS route that
answers with faker-generated data, so no Marketo tenant is needed.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

The server listens on `127.0.0.1:3000` by default, so only this machine can
reach it. `HOST` and `PORT` change that (csh and tcsh set `HOST` on their own):

```bash
# another port
$ PORT=4311 npm run start

# reachable from other machines or containers
$ HOST=0.0.0.0 npm run start
```

## API documentation

When the application is running, Swagger UI is available at
[http://localhost:3000/api](http://localhost:3000/api). The generated OpenAPI
document is available at
[http://localhost:3000/api-json](http://localhost:3000/api-json).

## Mock Marketo Asset API

Every endpoint under `/rest/asset/**` mirrors the Marketo Asset REST API
(`docs/marketo-swagger-asset.json`) and answers with faker-generated data, so no
Marketo tenant is required.

The TypeScript surface is fully generated from the Swagger document — never edit
these folders by hand, regenerate them instead:

| Folder                  | Contents                                                 | Generator                                 |
| ----------------------- | -------------------------------------------------------- | ----------------------------------------- |
| `src/asset/asset-definitions` | 255 models, requests and responses                       | `scripts/generate-marketo-definitions.py` |
| `src/asset/resources`   | 23 Nest modules covering all 220 operations              | `scripts/generate-marketo-resources.py`   |
| `src/asset/asset-mocks`       | 255 faker factories plus the seed and request-id helpers | `scripts/generate-marketo-factories.py`   |

```bash
# regenerate everything after changing the Swagger document
npm run generate:all

# fail if any generated file is out of date (use this in CI)
npm run check:all
```

### Reproducible mock data

Responses are random by default. Set `MARKETO_MOCK_SEED` to pin them so the same
request returns the same payload across restarts:

```bash
MARKETO_MOCK_SEED=42 npm run start
```

Seeding also pins the reference date used by relative date helpers. Override it
with `MARKETO_MOCK_REF_DATE` (defaults to `2024-01-01T00:00:00.000Z`).

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```
