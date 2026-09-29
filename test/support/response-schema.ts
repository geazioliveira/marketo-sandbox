import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * The Marketo Swagger documents in docs/, read as data, and a small checker
 * that holds a response to the schema a document declares for it (#24).
 *
 * The checker knows only the keywords the five documents use for their
 * responses: `$ref`, `allOf`, `type`, `properties`, `required`, `items`,
 * `enum` and `additionalProperties`. Anything else, such as `format` or
 * `example`, is not checked.
 */

const docs = path.resolve(__dirname, '..', '..', 'docs')

export interface Schema {
  $ref?: string
  allOf?: Schema[]
  type?: string
  properties?: Record<string, Schema>
  required?: string[]
  items?: Schema
  enum?: unknown[]
  additionalProperties?: boolean | Schema
  description?: string
}

export interface Parameter {
  name: string
  in: string
  type?: string
  required?: boolean
  schema?: Schema
}

export interface Response {
  schema?: Schema
  content?: Record<string, { schema?: Schema }>
  headers?: Record<string, unknown>
}

export interface Operation {
  operationId: string
  consumes?: string[]
  parameters?: Parameter[]
  responses: Record<string, Response>
}

export interface SwaggerDocument {
  consumes?: string[]
  paths: Record<string, Record<string, Operation>>
  definitions?: Record<string, Schema>
  components?: { schemas?: Record<string, Schema> }
}

/** One operation of a document, with the method and the Swagger path. */
export interface DocumentedOperation {
  file: string
  document: SwaggerDocument
  method: string
  path: string
  operation: Operation
}

const httpMethods = new Set([
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
])

export function readDocument(file: string): SwaggerDocument {
  return JSON.parse(
    readFileSync(path.join(docs, file), 'utf8'),
  ) as SwaggerDocument
}

/** Every operation of a document, in the document's order. */
export function operationsOf(file: string): DocumentedOperation[] {
  const document = readDocument(file)
  return Object.entries(document.paths).flatMap(([route, item]) =>
    Object.entries(item)
      .filter(([method]) => httpMethods.has(method))
      .map(([method, operation]) => ({
        file,
        document,
        method,
        path: route,
        operation,
      })),
  )
}

/** The media types an operation consumes, its own or the document's. */
export function consumesOf({
  document,
  operation,
}: DocumentedOperation): string[] {
  return operation.consumes ?? document.consumes ?? []
}

/** The lowest 2xx status the operation declares, and its response. */
export function successResponse({ operation }: DocumentedOperation): {
  status: number
  response: Response
} {
  const status = Object.keys(operation.responses)
    .filter((code) => /^2\d\d$/.test(code))
    .sort()[0]
  return { status: Number(status), response: operation.responses[status] }
}

/** The body schema of a response, from Swagger 2 or from OpenAPI 3. */
export function responseSchema(response: Response): Schema | undefined {
  return response.schema ?? response.content?.['application/json']?.schema
}

export function definition(
  document: SwaggerDocument,
  reference: string,
): { name: string; schema: Schema } {
  const name = reference.split('/').pop() as string
  const schema = (document.definitions ?? document.components?.schemas ?? {})[
    name
  ]
  if (!schema) {
    throw new Error(`${reference} is not defined in the document`)
  }
  return { name, schema }
}

/**
 * A mismatch between a value and its schema. `definition` names the
 * definition whose rule failed, when the rule came from one, and `missing`
 * the required property that was absent.
 */
export interface SchemaError {
  at: string
  message: string
  definition?: string
  missing?: string
}

const typeChecks: Record<string, (value: unknown) => boolean> = {
  object: (value) =>
    typeof value === 'object' && value !== null && !Array.isArray(value),
  array: Array.isArray,
  string: (value) => typeof value === 'string',
  integer: Number.isInteger,
  number: (value) => typeof value === 'number',
  boolean: (value) => typeof value === 'boolean',
}

/** Every way `value` departs from `schema`, empty when it conforms. */
export function schemaErrors(
  document: SwaggerDocument,
  schema: Schema,
  value: unknown,
  at = '$',
  owner?: string,
): SchemaError[] {
  if (schema.$ref) {
    const target = definition(document, schema.$ref)
    return schemaErrors(document, target.schema, value, at, target.name)
  }

  const errors = (schema.allOf ?? []).flatMap((part) =>
    schemaErrors(document, part, value, at, owner),
  )
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push({
      at,
      message: `${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`,
      definition: owner,
    })
  }

  const type = schema.type ?? (schema.properties ? 'object' : undefined)
  if (type === undefined) {
    return errors
  }
  const check = typeChecks[type]
  if (!check) {
    throw new Error(`${at}: the checker does not know the type ${type}`)
  }
  if (!check(value)) {
    errors.push({
      at,
      message: `expected ${type}, got ${JSON.stringify(value)}`,
      definition: owner,
    })
    return errors
  }

  if (type === 'array' && schema.items) {
    const items = schema.items
    ;(value as unknown[]).forEach((item, index) =>
      errors.push(
        ...schemaErrors(document, items, item, `${at}[${index}]`, owner),
      ),
    )
  }

  if (type === 'object') {
    const record = value as Record<string, unknown>
    const properties = schema.properties ?? {}
    // Every property, not only the required ones: the factories fill each
    // declared property (ADR 0007), and with the envelopes declaring nothing
    // required, `{}` would otherwise pass for most responses.
    const declared = new Set([
      ...(schema.required ?? []),
      ...Object.keys(properties),
    ])
    for (const name of declared) {
      if (!(name in record)) {
        errors.push({
          at,
          message: `missing ${name}`,
          definition: owner,
          missing: name,
        })
      }
    }
    for (const [name, item] of Object.entries(record)) {
      const property = properties[name]
      if (property) {
        errors.push(
          ...schemaErrors(document, property, item, `${at}.${name}`, owner),
        )
      } else if (typeof schema.additionalProperties === 'object') {
        errors.push(
          ...schemaErrors(
            document,
            schema.additionalProperties,
            item,
            `${at}.${name}`,
            owner,
          ),
        )
      }
    }
  }
  return errors
}
