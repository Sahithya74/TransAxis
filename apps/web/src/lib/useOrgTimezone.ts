import { useAuth } from '../auth/AuthProvider';
import { DEFAULT_TZ } from './format';

/** Times are shown and entered in the organisation's timezone, whatever the browser's is. */
export const useOrgTimezone = () => useAuth().organization?.timezone ?? DEFAULT_TZ;
