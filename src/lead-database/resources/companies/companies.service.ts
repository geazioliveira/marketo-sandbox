import { Injectable } from '@nestjs/common'
import { makeResponseOfCompany } from '../../lead-database-mocks/factories/response-of-company'
import { makeResponseOfLeadField } from '../../lead-database-mocks/factories/response-of-lead-field'
import { makeResponseOfObjectMetaData } from '../../lead-database-mocks/factories/response-of-object-meta-data'

import type { ResponseOfCompany } from '../../lead-database-definitions/responses/response-of-company'
import type { ResponseOfLeadField } from '../../lead-database-definitions/responses/response-of-lead-field'
import type { ResponseOfObjectMetaData } from '../../lead-database-definitions/responses/response-of-object-meta-data'

@Injectable()
export class CompaniesService {
  async getCompaniesUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfCompany> {
    return makeResponseOfCompany()
  }

  async syncCompaniesUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfCompany> {
    return makeResponseOfCompany()
  }

  async deleteCompaniesUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfCompany> {
    return makeResponseOfCompany()
  }

  async describeUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfObjectMetaData> {
    return makeResponseOfObjectMetaData()
  }

  async getCompanyFieldByNameUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfLeadField> {
    return makeResponseOfLeadField()
  }

  async getCompanyFieldsUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfLeadField> {
    return makeResponseOfLeadField()
  }
}
