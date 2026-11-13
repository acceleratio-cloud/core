import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { Globe } from 'lucide-react';
import { Logo } from '@/components/logo';
import { gitConfig } from './shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <Logo />,
      url: '/',
    },
    links: [
      {
        type: 'icon',
        label: 'Website',
        text: 'Website',
        icon: <Globe />,
        url: 'https://acceleratio.cloud',
        external: true,
      },
    ],
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
    themeSwitch: { enabled: false },
  };
}
