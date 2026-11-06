import { ControlPlaneUrlSettings } from './control-plane-url-settings';
import { PlatformVersionSettings } from './platform-version-settings';

/** The platform version and updates, then the control plane URL. */
export const SystemPanel = () => (
  <div className="flex flex-col gap-4">
    <PlatformVersionSettings />
    <ControlPlaneUrlSettings />
  </div>
);
