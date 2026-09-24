import { faker } from '@faker-js/faker'
import type { LandingPageContentResponse } from '../../asset-definitions/responses/landing-page-content-response'
import { makeJsonNode } from './json-node'

export function makeLandingPageContentResponse(
  overrides: Partial<LandingPageContentResponse> = {},
): LandingPageContentResponse {
  return {
    content: {},
    followupType: faker.helpers.arrayElement([
      'url',
      'lp',
      'formDefined',
    ] as const),
    followupValue: faker.lorem.word(),
    formattingOptions: makeJsonNode(),
    id: {},
    index: faker.number.int({ min: 1, max: 1000 }),
    type: faker.helpers.arrayElement([
      'Image',
      'SocialButton',
      'Form',
      'DynamicContent',
      'Rectangle',
      'Snippet',
      'RichText',
      'HTML',
      'Video',
      'Poll',
      'ReferralOffer',
      'Sweepstakes',
    ] as const),
    ...overrides,
  }
}
