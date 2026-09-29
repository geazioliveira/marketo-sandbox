import { Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { MultipartInterceptor } from './multipart.interceptor'

/**
 * Hands the parts of a multipart request to every route (#24). It lives
 * beside the generated code, not in it (ADR 0009, ADR 0013).
 */
@Module({
  providers: [{ provide: APP_INTERCEPTOR, useClass: MultipartInterceptor }],
})
export class MultipartModule {}
