import type { Error } from '../models/error';
import type { LandingPageContentResponse } from './landing-page-content-response';

export interface ResponseOfLandingPageContentResponse {
  errors?: Array<Error>;
  requestId?: string;
  result?: Array<LandingPageContentResponse>;
  success?: boolean;
  warnings?: Array<string>;
}
