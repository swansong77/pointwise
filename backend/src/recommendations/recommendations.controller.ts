import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../common/decorators';
import { RecommendationsService } from './recommendations.service';

@ApiTags('recommendations')
@ApiBearerAuth()
@Controller('recommendations')
export class RecommendationsController {
  constructor(private readonly recs: RecommendationsService) {}

  @Get('categories')
  all(@CurrentUser() u: AuthUser) {
    return this.recs.allCategories(u.sub);
  }

  @Get('categories/:idOrSlug')
  category(@CurrentUser() u: AuthUser, @Param('idOrSlug') id: string) {
    return this.recs.forCategory(u.sub, id);
  }

  @Get('merchants/:idOrSlug')
  merchant(@CurrentUser() u: AuthUser, @Param('idOrSlug') id: string) {
    return this.recs.forMerchant(u.sub, id);
  }
}
