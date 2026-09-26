import { INestApplication, Type } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { App } from 'supertest/types'
import type { MockInstance } from 'vitest'
import { AppModule } from '../src/app.module'
import { EmailTemplatesNewService } from '../src/asset/resources/email-templates-new/email-templates-new.service'
import { EmailsService } from '../src/asset/resources/emails/emails.service'
import { EmailsNewService } from '../src/asset/resources/emails-new/emails-new.service'
import { FormFieldsService } from '../src/asset/resources/form-fields/form-fields.service'
import { FormsService } from '../src/asset/resources/forms/forms.service'
import { FragmentsNewService } from '../src/asset/resources/fragments-new/fragments-new.service'
import { SmartCampaignsService } from '../src/asset/resources/smart-campaigns/smart-campaigns.service'
import { SmartListsService } from '../src/asset/resources/smart-lists/smart-lists.service'
import { StaticListsService } from '../src/asset/resources/static-lists/static-lists.service'
import { CustomObjectsService } from '../src/lead-database/resources/custom-objects/custom-objects.service'
import {
  documentedRoutes,
  routeLayers,
  swaggerDocuments,
} from './support/marketo-routes'

/**
 * Express hands a request to the first registered route whose path matches
 * it, so a literal route declared after a `:param` route of the same method
 * never runs: `:id` takes `byName` as readily as `12` (#8). The resource
 * generator orders each controller so that a route comes before any route
 * that would capture it (scripts/generate-marketo-resources.py). These tests
 * hold the whole app to that, the order between controllers included.
 */

/**
 * A request every route with that path accepts: each `:param` becomes `{}`.
 * No literal segment holds braces, so a literal route never takes it.
 */
function sampleRequest(routePath: string): string {
  return routePath.replace(/:[A-Za-z_$][\w$]*/g, '{}')
}

/** The names of the methods of a service. */
type Handler<S> = {
  [K in keyof S]: S[K] extends (...args: never[]) => unknown ? K : never
}[keyof S] &
  string

/** A request, the handler it must reach, and a handler it must not reach. */
interface Row {
  method: 'get' | 'post'
  path: string
  handler: string
  spyOn: (app: INestApplication) => {
    reached: MockInstance
    mustNotReach: MockInstance
  }
}

function row<S extends object, O extends object>(
  method: Row['method'],
  path: string,
  [service, handler]: [Type<S>, Handler<S>],
  [otherService, otherHandler]: [Type<O>, Handler<O>],
): Row {
  // Handler<S> already ties each name to its service; vi.spyOn only needs to
  // see an object with that method.
  const methodsOf = (instance: object) =>
    instance as Record<string, (...args: unknown[]) => unknown>
  return {
    method,
    path,
    handler,
    spyOn: (app) => ({
      reached: vi.spyOn(methodsOf(app.get(service)), handler),
      mustNotReach: vi.spyOn(methodsOf(app.get(otherService)), otherHandler),
    }),
  }
}

const rows: Row[] = [
  // The 13 routes the generator used to shadow, each with the handler of the
  // `:param` route that took its requests.
  row(
    'get',
    '/rest/asset/v1/smartCampaign/byName.json?name=x',
    [SmartCampaignsService, 'getSmartCampaignByNameUsingGET'],
    [SmartCampaignsService, 'getSmartCampaignByIdUsingGET'],
  ),
  row(
    'get',
    '/rest/asset/v1/smartCampaign/rules.json',
    [SmartCampaignsService, 'getSmartCampaignRulesUsingGET'],
    [SmartCampaignsService, 'getSmartCampaignByIdUsingGET'],
  ),
  row(
    'get',
    '/rest/asset/v1/smartCampaign/flowSteps.json',
    [SmartCampaignsService, 'getSmartCampaignFlowStepsUsingGET'],
    [SmartCampaignsService, 'getSmartCampaignByIdUsingGET'],
  ),
  row(
    'get',
    '/rest/asset/v1/smartCampaign/flowStepTypes.json',
    [SmartCampaignsService, 'getSmartCampaignFlowStepTypesUsingGET'],
    [SmartCampaignsService, 'getSmartCampaignByIdUsingGET'],
  ),
  row(
    'get',
    '/rest/asset/v1/smartList/byName.json?name=x',
    [SmartListsService, 'getSmartListByNameUsingGET'],
    [SmartListsService, 'getSmartListByIdUsingGET'],
  ),
  row(
    'get',
    '/rest/asset/v1/smartList/rules.json',
    [SmartListsService, 'getSmartListRulesUsingGET'],
    [SmartListsService, 'getSmartListByIdUsingGET'],
  ),
  row(
    'get',
    '/rest/asset/v1/staticList/byName.json?name=x',
    [StaticListsService, 'getStaticListByNameUsingGET'],
    [StaticListsService, 'getStaticListByIdUsingGET'],
  ),
  row(
    'get',
    '/rest/asset/v1/email/ccFields.json',
    [EmailsService, 'getEmailCCFieldsUsingGET'],
    [EmailsService, 'getEmailByIdUsingGET'],
  ),
  row(
    'post',
    '/rest/asset/v2/email/bulk/delete',
    [EmailsNewService, 'bulkDeleteUsingPOST_email'],
    [EmailsNewService, 'deleteContentUsingPOST_email'],
  ),
  row(
    'post',
    '/rest/asset/v2/emailtemplate/bulk/delete',
    [EmailTemplatesNewService, 'bulkDeleteUsingPOST_emailtemplate'],
    [EmailTemplatesNewService, 'deleteContentUsingPOST_emailtemplate'],
  ),
  row(
    'post',
    '/rest/asset/v2/fragment/bulk/delete',
    [FragmentsNewService, 'bulkDeleteUsingPOST_fragment'],
    [FragmentsNewService, 'deleteContentUsingPOST_fragment'],
  ),
  row(
    'get',
    '/rest/v1/customobjects/schema.json',
    [CustomObjectsService, 'listCustomObjectTypesUsingGET'],
    [CustomObjectsService, 'getCustomObjectsUsingGET'],
  ),
  row(
    'post',
    '/rest/v1/customobjects/schema.json',
    [CustomObjectsService, 'syncCustomObjectTypeUsingPOST'],
    [CustomObjectsService, 'syncCustomObjectsUsingPOST'],
  ),
  // Across controllers: only the alphabetical order of the resource modules
  // puts form-fields before forms, and nothing in the generator keeps it.
  row(
    'get',
    '/rest/asset/v1/form/fields.json',
    [FormFieldsService, 'getAllFieldsUsingGET'],
    [FormsService, 'getLpFormByIdUsingGET'],
  ),
  row(
    'get',
    '/rest/asset/v1/form/programMemberFields.json',
    [FormFieldsService, 'getAllProgramMemberFieldsUsingGET'],
    [FormsService, 'getLpFormByIdUsingGET'],
  ),
  // Controls: a real id still reaches the `:param` routes.
  row(
    'get',
    '/rest/asset/v1/smartCampaign/12.json',
    [SmartCampaignsService, 'getSmartCampaignByIdUsingGET'],
    [SmartCampaignsService, 'getSmartCampaignByNameUsingGET'],
  ),
  row(
    'get',
    '/rest/v1/customobjects/car_c.json',
    [CustomObjectsService, 'getCustomObjectsUsingGET'],
    [CustomObjectsService, 'listCustomObjectTypesUsingGET'],
  ),
]

describe('Route order (e2e)', () => {
  let app: INestApplication<App>

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('the mounted router', () => {
    it('reads the Express route layers and their matchers', () => {
      const layers = routeLayers(app)
      // Guards against a pass on nothing: a router that exposes fewer
      // routes, or no matcher, would leave the next test with little to see.
      expect(layers.length).toBeGreaterThanOrEqual(
        swaggerDocuments().flatMap(documentedRoutes).length,
      )
      expect(
        layers.filter((layer) => typeof layer.match !== 'function'),
      ).toEqual([])
    })

    it('sends a request for every route to that route, not to one declared before it', () => {
      const layers = routeLayers(app)
      const captured = layers.flatMap((layer) =>
        Object.keys(layer.route.methods).flatMap((method) => {
          const sample = sampleRequest(layer.route.path)
          const first = layers.find(
            (candidate) =>
              candidate.route.methods[method] && candidate.match?.(sample),
          )
          return first === layer
            ? []
            : [
                `${method.toUpperCase()} ${layer.route.path} is captured by ${first?.route.path ?? 'no route'}`,
              ]
        }),
      )
      expect(captured).toEqual([])
    })
  })

  describe('over HTTP', () => {
    it.each(rows)(
      '$method $path reaches $handler',
      async ({ method, path, spyOn }) => {
        const { reached, mustNotReach } = spyOn(app)

        await request(app.getHttpServer())[method](path).expect(200)

        expect(reached).toHaveBeenCalledTimes(1)
        expect(mustNotReach).not.toHaveBeenCalled()
      },
    )
  })
})
