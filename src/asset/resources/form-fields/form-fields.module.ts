import { Module } from '@nestjs/common'
import { FormFieldsController } from './form-fields.controller'
import { FormFieldsService } from './form-fields.service'

@Module({
  controllers: [FormFieldsController],
  providers: [FormFieldsService],
})
export class FormFieldsModule {}
