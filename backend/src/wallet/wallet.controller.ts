import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../common/decorators';
import { AddWalletCardDto, PinDto, RelinkDto, ReorderDto, UpdateWalletCardDto, ValuationDto } from './wallet.dto';
import { WalletService } from './wallet.service';

@ApiTags('wallet')
@ApiBearerAuth()
@Controller('wallet')
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get('cards')
  list(@CurrentUser() u: AuthUser) {
    return this.wallet.list(u.sub);
  }

  @Post('cards')
  add(@CurrentUser() u: AuthUser, @Body() dto: AddWalletCardDto) {
    return this.wallet.add(u.sub, dto);
  }

  @Patch('cards/:id')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateWalletCardDto) {
    return this.wallet.update(u.sub, id, dto);
  }

  @Get('custom-matches')
  customMatches(@CurrentUser() u: AuthUser) {
    return this.wallet.customMatches(u.sub);
  }

  @Post('custom-matches')
  @HttpCode(200)
  relink(@CurrentUser() u: AuthUser, @Body() dto: RelinkDto) {
    return this.wallet.relinkCustom(u.sub, dto.walletCardIds);
  }

  @Delete('cards/:id')
  @HttpCode(204)
  remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.wallet.remove(u.sub, id);
  }

  @Put('order')
  @HttpCode(204)
  reorder(@CurrentUser() u: AuthUser, @Body() dto: ReorderDto) {
    return this.wallet.reorder(u.sub, dto.walletCardIds);
  }

  @Post('pins')
  pin(@CurrentUser() u: AuthUser, @Body() dto: PinDto) {
    return this.wallet.pin(u.sub, dto);
  }

  @Delete('pins')
  @HttpCode(204)
  unpin(@CurrentUser() u: AuthUser, @Query('categoryId') categoryId?: string, @Query('merchantId') merchantId?: string) {
    return this.wallet.unpin(u.sub, { categoryId, merchantId });
  }

  @Put('valuations')
  valuation(@CurrentUser() u: AuthUser, @Body() dto: ValuationDto) {
    return this.wallet.setValuation(u.sub, dto);
  }
}
