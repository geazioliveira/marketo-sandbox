import { Module } from '@nestjs/common'
import { CompaniesModule } from './companies/companies.module'
import { CustomObjectsModule } from './custom-objects/custom-objects.module'
import { ListsModule } from './lists/lists.module'
import { PersonsModule } from './persons/persons.module'
import { ProgramMembersModule } from './program-members/program-members.module'

@Module({
  imports: [
    CompaniesModule,
    CustomObjectsModule,
    ListsModule,
    PersonsModule,
    ProgramMembersModule,
  ],
})
export class DataIngestionResourcesModule {}
