import { Module } from '@nestjs/common';
import { AssetResourcesModule } from './resources/asset-resources.module';

@Module({
  imports: [AssetResourcesModule],
})
export class AssetModule {}
