import { isDesktop } from './desktop';
import { useBrowserTracker } from './useBrowserTracker';
import { useNativeTracker } from './useNativeTracker';

// The environment is fixed for this renderer's lifetime.
export const useTracker = isDesktop ? useNativeTracker : useBrowserTracker;
