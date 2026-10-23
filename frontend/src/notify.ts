import { toaster } from 'baseui/toast';
import { errorMessage } from './api';

export const notifyError = (e: unknown) => { toaster.negative(errorMessage(e), {}); };
export const notifyOk = (msg: string) => { toaster.positive(msg, {}); };
