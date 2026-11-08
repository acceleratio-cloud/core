import type { ComponentType, SVGProps } from 'react';
import Docker from '@thesvg/react/docker';
import Slack from '@thesvg/react/slack';
import Telegram from '@thesvg/react/telegram';

import { GithubIcon } from '@/shared/icons/github-icon';

type BrandIcon = ComponentType<SVGProps<SVGSVGElement>>;

export type IntegrationId = 'github' | 'dockerhub' | 'slack' | 'telegram';

export type Integration = {
  id: IntegrationId;
  name: string;
  description: string;
  icon: BrandIcon;
  /** Own page under Settings → Integrations; absent until it ships. */
  href?: string;
};

export const INTEGRATIONS: Integration[] = [
  {
    id: 'github',
    name: 'GitHub',
    description: 'Connect repositories through GitHub Apps that you own.',
    icon: GithubIcon,
    href: '/settings/integrations/github',
  },
  {
    id: 'dockerhub',
    name: 'Docker Hub',
    description: 'Pull private images from your Docker Hub registry.',
    icon: Docker,
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Send deploy and incident notifications to a channel.',
    icon: Slack,
  },
  {
    id: 'telegram',
    name: 'Telegram',
    description: 'Get alerts about your services in a Telegram chat.',
    icon: Telegram,
  },
];

export const getIntegration = (id: IntegrationId) =>
  INTEGRATIONS.find((item) => item.id === id)!;
