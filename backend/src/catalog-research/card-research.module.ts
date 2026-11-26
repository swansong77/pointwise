import {
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  IsArray,
} from "class-validator";
import { AuthUser, CurrentUser, Roles } from "../common/decorators";
import { RolesGuard } from "../common/guards";
import { AiCoreModule } from "../ai/ai.module";
import { CardRefreshCoreModule } from "../catalog-refresh/card-refresh.module";
import { CardResearchService } from "./card-research.service";

export class StartResearchDto {
  @ApiProperty({
    enum: ["DISCOVER", "VERIFY", "NEWS"],
    description:
      "DISCOVER an issuer's cards, VERIFY one catalog card, or scan card NEWS sites for new cards and offers",
  })
  @IsIn(["DISCOVER", "VERIFY", "NEWS"])
  kind: "DISCOVER" | "VERIFY" | "NEWS";
  @ApiPropertyOptional({
    example: "Chase",
    description: "DISCOVER: issuer to research (NEWS: optional issuer filter)",
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  issuer?: string;
  @ApiPropertyOptional({ description: "VERIFY: catalog card to re-check" })
  @IsOptional()
  @IsUUID()
  cardId?: string;
  @ApiPropertyOptional({ example: "no-annual-fee cash back cards" })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  focus?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 25, default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(25)
  limit?: number;
  @ApiPropertyOptional({
    default: true,
    description:
      "Let the agent read card news / community sites (Doctor of Credit, The Points Guy, MileMoa) for leads. Facts still come only from issuer pages.",
  })
  @IsOptional()
  @IsBoolean()
  useLeads?: boolean;
}
export class DiscoverAllDto {
  @ApiPropertyOptional({
    enum: ["BANK", "CREDIT_UNION", "CARD_COMPANY", "FINTECH"],
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsIn(["BANK", "CREDIT_UNION", "CARD_COMPANY", "FINTECH"], { each: true })
  kinds?: string[];
  @ApiPropertyOptional({
    default: 30,
    description: "skip issuers researched within this many days",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  staleDays?: number;
  @ApiPropertyOptional({ default: 60, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  max?: number;
}
export class VerifyAllDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  max?: number;
}
export class ApproveCandidateDto {
  @ApiPropertyOptional({
    description:
      "Approve although no fact could be checked against the product page",
  })
  @IsOptional()
  @IsBoolean()
  acceptUnverified?: boolean;
  @ApiPropertyOptional({
    description:
      "Existing card: replace its earning rates with the verified rates",
  })
  @IsOptional()
  @IsBoolean()
  applyRewards?: boolean;
  @ApiPropertyOptional({
    description: "New points currency: default ¢ per point (0–5)",
  })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(5)
  centsPerPoint?: number;
  @ApiPropertyOptional({ description: "Use this existing currency code" })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  currencyCode?: string;
}
export class RejectCandidateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
export class CandidateQuery {
  @ApiPropertyOptional({ enum: ["PENDING", "APPROVED", "REJECTED"] })
  @IsOptional()
  @IsIn(["PENDING", "APPROVED", "REJECTED"])
  status?: string;
}

@ApiTags("admin")
@ApiBearerAuth()
@Roles("ADMIN")
@UseGuards(RolesGuard)
@Controller("admin")
export class CardResearchController {
  constructor(private readonly research: CardResearchService) {}

  @Get("card-research/status")
  @ApiOperation({
    summary: "Whether a Claude model with web search is configured",
  })
  status() {
    return this.research.status();
  }
  @Post("card-research")
  @HttpCode(202)
  @ApiOperation({
    summary:
      "Queue a research run (the worker runs it; POST /admin/jobs/research-cards to start now)",
  })
  start(@CurrentUser() u: AuthUser, @Body() dto: StartResearchDto) {
    return this.research.start(dto, u.sub);
  }
  @Post("card-research/discover-all")
  @HttpCode(202)
  @ApiOperation({
    summary:
      "Queue a DISCOVER run for every registry issuer (banks, credit unions …) not researched recently — billed per run",
  })
  discoverAll(@CurrentUser() u: AuthUser, @Body() dto: DiscoverAllDto) {
    return this.research.discoverAll(u.sub, dto);
  }
  @Get("card-research/coverage")
  @ApiOperation({
    summary:
      "Catalog coverage per issuer: personal / business cards, verified, last research",
  })
  coverage() {
    return this.research.coverage();
  }
  @Post("card-research/verify-unverified") @HttpCode(202) verifyAll(
    @CurrentUser() u: AuthUser,
    @Body() dto: VerifyAllDto,
  ) {
    return this.research.verifyUnverified(u.sub, dto.max);
  }
  @Get("card-research") runs() {
    return this.research.runs();
  }
  @Get("card-research/:id") run(@Param("id", ParseUUIDPipe) id: string) {
    return this.research.run(id);
  }
  @Get("card-candidates") candidates(@Query() q: CandidateQuery) {
    return this.research.candidates(q.status);
  }
  @Post("card-candidates/:id/approve") @HttpCode(200) approve(
    @CurrentUser() u: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ApproveCandidateDto,
  ) {
    return this.research.approve(id, u.sub, dto);
  }
  @Post("card-candidates/:id/reject") @HttpCode(200) reject(
    @CurrentUser() u: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: RejectCandidateDto,
  ) {
    return this.research.reject(id, u.sub, dto.note);
  }
}

/** Shared by API and worker. */
@Module({
  imports: [AiCoreModule, CardRefreshCoreModule],
  providers: [CardResearchService],
  exports: [CardResearchService],
})
export class CardResearchCoreModule {}

@Module({
  imports: [CardResearchCoreModule],
  controllers: [CardResearchController],
})
export class CardResearchModule {}
