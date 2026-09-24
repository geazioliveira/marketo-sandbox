import { faker } from '@faker-js/faker'

/**
 * Marketo request ids look like `e42b#14272d07d78`.
 */
export function mockRequestId(): string {
  return `${faker.string.alphanumeric(4)}#${faker.string.alphanumeric(11)}`
}
