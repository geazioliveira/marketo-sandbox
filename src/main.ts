import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { AppModule } from './app.module'
import { useBodyLimit } from './body-limit'
import { seedMockData } from './mocks'
import { listenAddress } from './listen-address'

async function bootstrap() {
  seedMockData()

  const app = await NestFactory.create<NestExpressApplication>(AppModule)
  useBodyLimit(app)

  const config = new DocumentBuilder()
    .setTitle('Marketo API')
    .setDescription('API for managing Marketo assets')
    .setVersion('1.0')
    .build()
  const document = SwaggerModule.createDocument(app, config)
  SwaggerModule.setup('api', app, document)

  const { host, port } = listenAddress(process.env)
  await app.listen(port, host)
}
bootstrap()
