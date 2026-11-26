import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators';
import { CatalogService } from './catalog.service';
import { CardSearchQuery, MerchantSearchQuery } from './catalog.dto';

@ApiTags('catalog')
@Public()
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('cards')
  searchCards(@Query() q: CardSearchQuery) {
    return this.catalog.searchCards(q);
  }

  @Get('cards/:idOrSlug')
  getCard(@Param('idOrSlug') id: string) {
    return this.catalog.getCard(id);
  }

  @Get('issuers')
  issuers() {
    return this.catalog.listIssuers();
  }

  @Get('categories')
  categories() {
    return this.catalog.listCategories();
  }

  @Get('categories/:idOrSlug')
  category(@Param('idOrSlug') id: string) {
    return this.catalog.getCategory(id);
  }

  @Get('merchants')
  merchants(@Query() q: MerchantSearchQuery) {
    return this.catalog.searchMerchants(q);
  }

  @Get('merchants/by-host')
  @ApiQuery({ name: 'host', example: 'example.com' })
  byHost(@Query('host') host: string) {
    return this.catalog.merchantByHost(String(host ?? '').slice(0, 253));
  }

  @Get('merchants/:idOrSlug')
  merchant(@Param('idOrSlug') id: string) {
    return this.catalog.getMerchant(id);
  }
}
