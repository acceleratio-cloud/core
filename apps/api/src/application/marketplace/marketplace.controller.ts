import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import type {
  DeployMarketplaceAppPayload,
  MarketplaceApp,
  MarketplaceDeployment,
} from '@acceleratio/shared';

import { MarketplaceDeployService } from './marketplace-deploy.service';
import { MarketplaceService } from './marketplace.service';

@Controller('marketplace/apps')
export class MarketplaceController {
  constructor(
    private readonly marketplaceService: MarketplaceService,
    private readonly deployService: MarketplaceDeployService,
  ) {}

  @Get()
  list(): MarketplaceApp[] {
    return this.marketplaceService.list();
  }

  /** Creates the app's services in a project and deploys them. */
  @Post(':slug/deploy')
  deploy(
    @Param('slug') slug: string,
    @Body() body: DeployMarketplaceAppPayload,
    @Session() session: UserSession | null,
  ): Promise<MarketplaceDeployment> {
    return this.deployService.deploy(
      slug,
      body,
      session
        ? {
            id: session.user.id,
            name: session.user.name,
            email: session.user.email,
          }
        : null,
    );
  }
}
