import type { ContentWaveErrorDTO } from '../models/content-wave-error-dto';

export interface ErrorResponse {
  success?: boolean;
  requestId?: string;
  errors?: Array<ContentWaveErrorDTO>;
}
