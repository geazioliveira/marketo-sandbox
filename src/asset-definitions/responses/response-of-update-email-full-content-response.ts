import type { Error } from '../models/error';
import type { UpdateEmailFullContentResponse } from './update-email-full-content-response';

export interface ResponseOfUpdateEmailFullContentResponse {
  errors?: Array<Error>;
  requestId?: string;
  result?: Array<UpdateEmailFullContentResponse>;
  success?: boolean;
  warnings?: Array<string>;
}
