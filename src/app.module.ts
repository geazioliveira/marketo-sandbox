import { Module } from '@nestjs/common'
import { AssetModule } from './asset/asset.module'

@Module({
  imports: [AssetModule],
})
export class AppModule {}
