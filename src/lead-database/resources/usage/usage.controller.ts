import { Controller, Get } from '@nestjs/common'
import { UsageService } from './usage.service'

import type { ResponseOfErrorsData } from '../../lead-database-definitions/responses/response-of-errors-data'
import type { ResponseOfUsageData } from '../../lead-database-definitions/responses/response-of-usage-data'

@Controller()
export class UsageController {
  constructor(private readonly usageService: UsageService) {}

  @Get('rest/v1/stats/errors.json')
  async getDailyErrorsUsingGET(): Promise<ResponseOfErrorsData> {
    return this.usageService.getDailyErrorsUsingGET()
  }

  @Get('rest/v1/stats/errors/last7days.json')
  async getLast7DaysErrorsUsingGET(): Promise<ResponseOfErrorsData> {
    return this.usageService.getLast7DaysErrorsUsingGET()
  }

  @Get('rest/v1/stats/usage.json')
  async getDailyUsageUsingGET(): Promise<ResponseOfUsageData> {
    return this.usageService.getDailyUsageUsingGET()
  }

  @Get('rest/v1/stats/usage/last7days.json')
  async getLast7DaysUsageUsingGET(): Promise<ResponseOfUsageData> {
    return this.usageService.getLast7DaysUsageUsingGET()
  }
}
