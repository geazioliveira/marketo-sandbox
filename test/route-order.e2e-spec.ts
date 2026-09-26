import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { INestApplication, Type } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { App } from 'supertest/types'
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

/**
 * Express hands a request to the first registered route whose path matches
 * it, so a literal route declared after a `:param` route of the same method
 * never runs: `:id` takes `byName` as readily as `12` (#8). The resource
 * generator orders each controller so that a route comes before any route
 * that would capture it (scripts/generate-marketo-resources.py). These tests
 * hold the whole app to that, the order between controllers included.
 */

const root = path.resolve(__dirname, '..')
const httpMethods = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
]

interface RouterLayer {
  route?: { path: string; methods: Record<string, boolean> }
  match?: (path: string) => boolean
}

interface RouteLayer extends RouterLayer {
  route: { path: string; methods: Record<string, boolean> }
}

/** Every operation the Swagger documents in docs/ declare. */
function documentedOperationCount(): number {
  return readdirSync(path.join(root, 'docs'))
    .filter((file) => /^marketo-swagger-.+\.json$/.test(file))
    .flatMap((file) => {
      const { paths } = JSON.parse(
        readFileSync(path.join(root, 'docs', file), 'utf8'),
      ) as { paths: Record<string, Record<string, unknown>> }
      return Object.values(paths).flatMap((item) =>
        Object.keys(item).filter((method) => httpMethods.includes(method)),
      )
    }).length
}

function routeLayers(app: INestApplication): RouteLayer[] {
  const { stack } = app.getHttpAdapter().getInstance().router as {
    stack: RouterLayer[]
  }
  return stack.filter((layer): layer is RouteLayer => Boolean(layer.route))
}

/** A request the route accepts: every `:param` becomes `1`. */
function sampleRequest(routePath: string): string {
  return routePath.replace(/:[A-Za-z_$][\w$]*/g, '1')
}

/** A request, the handler it must reach, and the handler that used to take it. */
interface Row {
  method: 'get' | 'post'
  path: string
  service: Type<object>
  handler: string
  capturedBy: [Type<object>, string]
}

const rows: Row[] = [
  {
    method: 'get',
    path: '/rest/asset/v1/smartCampaign/byName.json?name=x',
    service: SmartCampaignsService,
    handler: 'getSmartCampaignByNameUsingGET',
    capturedBy: [SmartCampaignsService, 'getSmartCampaignByIdUsingGET'],
  },
  {
    method: 'get',
    path: '/rest/asset/v1/smartCampaign/rules.json',
    service: SmartCampaignsService,
    handler: 'getSmartCampaignRulesUsingGET',
    capturedBy: [SmartCampaignsService, 'getSmartCampaignByIdUsingGET'],
  },
  {
    method: 'get',
    path: '/rest/asset/v1/smartCampaign/flowSteps.json',
    service: SmartCampaignsService,
    handler: 'getSmartCampaignFlowStepsUsingGET',
    capturedBy: [SmartCampaignsService, 'getSmartCampaignByIdUsingGET'],
  },
  {
    method: 'get',
    path: '/rest/asset/v1/smartCampaign/flowStepTypes.json',
    service: SmartCampaignsService,
    handler: 'getSmartCampaignFlowStepTypesUsingGET',
    capturedBy: [SmartCampaignsService, 'getSmartCampaignByIdUsingGET'],
  },
  {
    method: 'get',
    path: '/rest/asset/v1/smartList/byName.json?name=x',
    service: SmartListsService,
    handler: 'getSmartListByNameUsingGET',
    capturedBy: [SmartListsService, 'getSmartListByIdUsingGET'],
  },
  {
    method: 'get',
    path: '/rest/asset/v1/smartList/rules.json',
    service: SmartListsService,
    handler: 'getSmartListRulesUsingGET',
    capturedBy: [SmartListsService, 'getSmartListByIdUsingGET'],
  },
  {
    method: 'get',
    path: '/rest/asset/v1/staticList/byName.json?name=x',
    service: StaticListsService,
    handler: 'getStaticListByNameUsingGET',
    capturedBy: [StaticListsService, 'getStaticListByIdUsingGET'],
  },
  {
    method: 'get',
    path: '/rest/asset/v1/email/ccFields.json',
    service: EmailsService,
    handler: 'getEmailCCFieldsUsingGET',
    capturedBy: [EmailsService, 'getEmailByIdUsingGET'],
  },
  {
    method: 'post',
    path: '/rest/asset/v2/email/bulk/delete',
    service: EmailsNewService,
    handler: 'bulkDeleteUsingPOST_email',
    capturedBy: [EmailsNewService, 'deleteContentUsingPOST_email'],
  },
  {
    method: 'post',
    path: '/rest/asset/v2/emailtemplate/bulk/delete',
    service: EmailTemplatesNewService,
    handler: 'bulkDeleteUsingPOST_emailtemplate',
    capturedBy: [
      EmailTemplatesNewService,
      'deleteContentUsingPOST_emailtemplate',
    ],
  },
  {
    method: 'post',
    path: '/rest/asset/v2/fragment/bulk/delete',
    service: FragmentsNewService,
    handler: 'bulkDeleteUsingPOST_fragment',
    capturedBy: [FragmentsNewService, 'deleteContentUsingPOST_fragment'],
  },
  {
    method: 'get',
    path: '/rest/v1/customobjects/schema.json',
    service: CustomObjectsService,
    handler: 'listCustomObjectTypesUsingGET',
    capturedBy: [CustomObjectsService, 'getCustomObjectsUsingGET'],
  },
  {
    method: 'post',
    path: '/rest/v1/customobjects/schema.json',
    service: CustomObjectsService,
    handler: 'syncCustomObjectTypeUsingPOST',
    capturedBy: [CustomObjectsService, 'syncCustomObjectsUsingPOST'],
  },
  // Across controllers: only the alphabetical order of the resource modules
  // puts form-fields before forms today.
  {
    method: 'get',
    path: '/rest/asset/v1/form/fields.json',
    service: FormFieldsService,
    handler: 'getAllFieldsUsingGET',
    capturedBy: [FormsService, 'getLpFormByIdUsingGET'],
  },
  {
    method: 'get',
    path: '/rest/asset/v1/form/programMemberFields.json',
    service: FormFieldsService,
    handler: 'getAllProgramMemberFieldsUsingGET',
    capturedBy: [FormsService, 'getLpFormByIdUsingGET'],
  },
  // Controls: a real id still reaches the `:param` routes.
  {
    method: 'get',
    path: '/rest/asset/v1/smartCampaign/12.json',
    service: SmartCampaignsService,
    handler: 'getSmartCampaignByIdUsingGET',
    capturedBy: [SmartCampaignsService, 'getSmartCampaignByNameUsingGET'],
  },
  {
    method: 'get',
    path: '/rest/v1/customobjects/car_c.json',
    service: CustomObjectsService,
    handler: 'getCustomObjectsUsingGET',
    capturedBy: [CustomObjectsService, 'listCustomObjectTypesUsingGET'],
  },
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
      expect(layers.length).toBeGreaterThanOrEqual(documentedOperationCount())
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
      async ({ method, path: url, service, handler, capturedBy }) => {
        const own = vi.spyOn(app.get(service) as never, handler as never)
        const [captorService, captorHandler] = capturedBy
        const captor = vi.spyOn(
          app.get(captorService) as never,
          captorHandler as never,
        )

        await request(app.getHttpServer())[method](url).expect(200)

        expect(own).toHaveBeenCalledTimes(1)
        expect(captor).not.toHaveBeenCalled()
      },
    )
  })
})
