import { errorMessage } from './api';
import { toast } from './components/ui';

export const notifyError = (e: unknown) => toast(errorMessage(e), 'error');
export const notifyOk = (msg: string) => toast(msg, 'ok');
