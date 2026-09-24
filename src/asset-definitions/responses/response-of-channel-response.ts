import type { ChannelResponse } from './channel-response';
import type { Error } from '../models/error';

export interface ResponseOfChannelResponse {
  errors?: Array<Error>;
  requestId?: string;
  result?: Array<ChannelResponse>;
  success?: boolean;
  warnings?: Array<string>;
}
