import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { AppModule, ObserveInstrument } from './app.module'
import { seedMockData } from './asset/asset-mocks'

async function bootstrap() {
  seedMockData()

  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
  })

  const config = new DocumentBuilder()
    .setTitle('Marketo API')
    .setDescription('API for managing Marketo assets')
    .setVersion('1.0')
    .build()
  const document = SwaggerModule.createDocument(app, config)
  SwaggerModule.setup('api', app, document)

  await app.listen(process.env.PORT ?? 3000)
}
bootstrap()
