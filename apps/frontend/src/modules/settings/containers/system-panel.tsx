import { ControlPlaneUrlSettings } from './control-plane-url-settings';
import { SystemSettings } from './system-settings';

/** General system settings, with the control plane URL below them. */
export const SystemPanel = () => (
  <div className="flex flex-col gap-4">
    <SystemSettings />
    <ControlPlaneUrlSettings />
  </div>
);
