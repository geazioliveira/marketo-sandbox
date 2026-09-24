import type { Error } from '../models/error';
import type { LandingPageDynamicContentResponse } from './landing-page-dynamic-content-response';

export interface ResponseOfLandingPageDynamicContentResponse {
  errors?: Array<Error>;
  requestId?: string;
  result?: Array<LandingPageDynamicContentResponse>;
  success?: boolean;
  warnings?: Array<string>;
}
