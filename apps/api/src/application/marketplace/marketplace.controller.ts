import { Controller, Get } from '@nestjs/common';
import type { MarketplaceApp } from '@acceleratio/shared';

import { MarketplaceService } from './marketplace.service';

@Controller('marketplace/apps')
export class MarketplaceController {
  constructor(private readonly marketplaceService: MarketplaceService) {}

  @Get()
  list(): MarketplaceApp[] {
    return this.marketplaceService.list();
  }
}
