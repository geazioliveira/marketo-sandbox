import type { NestExpressApplication } from '@nestjs/platform-express'

/**
 * The largest request body the mock reads, the one Marketo documents: it
 * answers 413 only when the payload passes 1 MB (Import Lead's 10 MB is a
 * multipart upload, which no body parser reads). The body-parser reads '1mb'
 * as 1,048,576 bytes.
 */
export const bodyLimit = '1mb'

/**
 * Raises the JSON and urlencoded parsers from the Express default of 100 KiB
 * to bodyLimit, so a 300-lead sync fits (#25). Call it before app.init() or
 * app.listen(): these parsers then run before the defaults Nest registers on
 * init, which see the body already read and pass it on. `extended: true`
 * keeps the urlencoded parsing Nest's default uses.
 */
export function useBodyLimit(app: NestExpressApplication): void {
  app.useBodyParser('json', { limit: bodyLimit })
  app.useBodyParser('urlencoded', { limit: bodyLimit, extended: true })
}
