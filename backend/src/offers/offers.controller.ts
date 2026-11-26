import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, Public } from '../common/decorators';
import { AddOfferToCardDto, CustomOfferDto, MyOffersQuery, OfferCatalogQuery, UpdateUserOfferDto } from './offers.dto';
import { OffersService } from './offers.service';

@ApiTags('offers')
@ApiBearerAuth()
@Controller('offers')
export class OffersController {
  constructor(private readonly offers: OffersService) {}

  @Public()
  @Get()
  catalog(@Query() q: OfferCatalogQuery) {
    return this.offers.catalog(q);
  }

  @Get('eligible')
  eligible(@CurrentUser() u: AuthUser) {
    return this.offers.eligible(u.sub);
  }

  @Get('mine')
  mine(@CurrentUser() u: AuthUser, @Query() q: MyOffersQuery) {
    return this.offers.mine(u.sub, q);
  }

  @Post('mine')
  add(@CurrentUser() u: AuthUser, @Body() dto: AddOfferToCardDto) {
    return this.offers.addToCard(u.sub, dto);
  }

  @Post('custom')
  custom(@CurrentUser() u: AuthUser, @Body() dto: CustomOfferDto) {
    return this.offers.createCustom(u.sub, dto);
  }

  @Patch('mine/:id')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserOfferDto) {
    return this.offers.update(u.sub, id, dto);
  }

  @Delete('mine/:id')
  @HttpCode(204)
  remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.offers.remove(u.sub, id);
  }
}
