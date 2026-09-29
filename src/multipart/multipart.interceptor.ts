import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import multer from 'multer'
import { Observable } from 'rxjs'

/**
 * Reads a `multipart/form-data` body into `req.body`, one entry per part, so
 * the generated controllers get every part through `@Body(...)` (#24).
 *
 * A text part becomes a string, and a file part the file multer read into
 * memory, under the name the part was sent with. The documents declare the
 * parts two ways: a `type: file` in `formData`, as the bulk imports do, or a
 * property of an `in: body` schema, as the asset uploads do. Both reach the
 * handler the same way, and the generator needs no change.
 *
 * An interceptor, not a middleware: Nest registers a middleware as a route of
 * the Express router, one that would match every request before the
 * documented routes. An interceptor runs once Express has picked the route
 * and before Nest reads the handler's parameters, as Nest's own
 * FileInterceptor does.
 *
 * multer passes over any request that is not multipart, so JSON and
 * urlencoded bodies are left to Nest's own parsers. Nothing limits the size:
 * the mock only listens on the local machine by default (ADR 0010).
 */
const readParts = multer({ storage: multer.memoryStorage() }).any()

@Injectable()
export class MultipartInterceptor implements NestInterceptor {
  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const http = context.switchToHttp()
    const request = http.getRequest<Request>()
    await new Promise<void>((resolve, reject) =>
      readParts(request, http.getResponse<Response>(), (error: unknown) =>
        error
          ? reject(new BadRequestException(`multipart body: ${String(error)}`))
          : resolve(),
      ),
    )
    const files = (request.files ?? []) as Express.Multer.File[]
    for (const file of files) {
      ;(request.body as Record<string, unknown>)[file.fieldname] = file
    }
    return next.handle()
  }
}
