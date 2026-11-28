import {
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UploadedFile,
  UploadedFiles,
  BadRequestException,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor, FilesInterceptor } from "@nestjs/platform-express";
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { AuthUser, CurrentUser } from "../common/decorators";
import { MAX_BULK_FILES, MAX_PDF_BYTES, SpendService } from "./spend.service";

const KINDS = ["PURCHASE", "CREDIT", "REFUND", "PAYMENT", "FEE"] as const;

export class StatementDto {
  @ApiProperty() @IsUUID() walletCardId: string;
  @ApiPropertyOptional({
    enum: ["positive", "negative"],
    description: "Override the detected sign of purchases",
  })
  @IsOptional()
  @IsIn(["positive", "negative"])
  purchasesAre?: "positive" | "negative";
}

export class BulkStatementDto {
  @ApiPropertyOptional({
    description:
      'JSON object: file name → wallet card id, for files whose card could not be detected (e.g. {"activity.csv":"<uuid>"})',
  })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  assignments?: string;
  @ApiPropertyOptional({ enum: ["positive", "negative"] })
  @IsOptional()
  @IsIn(["positive", "negative"])
  purchasesAre?: "positive" | "negative";
}

export class SpendListQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() walletCardId?: string;
  @ApiPropertyOptional({ description: "only the cards of this household member" })
  @IsOptional()
  @IsUUID()
  profileId?: string;
  @ApiPropertyOptional({ enum: KINDS })
  @IsOptional()
  @IsIn(KINDS as unknown as string[])
  kind?: (typeof KINDS)[number];
  @ApiPropertyOptional({
    description:
      "only transactions that did (true) / did not (false) update a benefit",
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === "true" || value === true
      ? true
      : value === "false" || value === false
        ? false
        : value,
  )
  @IsBoolean()
  matched?: boolean;
  @ApiPropertyOptional({ default: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

export class DaysQuery {
  @ApiPropertyOptional({ default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(400)
  days?: number;
}

export class RescanDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() walletCardId?: string;
  @ApiPropertyOptional({ default: 180 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(400)
  days?: number;
}

export class RulesDto {
  @ApiPropertyOptional({ type: [String], example: ["uber", "lyft"] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  keywords?: string[];
  @ApiPropertyOptional({ type: [String], example: ["dining"] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  categories?: string[];
  @ApiPropertyOptional({ type: [String], example: ["uber cash"] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  creditKeywords?: string[];
}

export class AutoTrackingDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() autoTrack?: boolean;
  @ApiPropertyOptional({
    type: RulesDto,
    nullable: true,
    description: "null = use the suggested rules",
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => RulesDto)
  rules?: RulesDto | null;
}

type Upload = { buffer: Buffer; originalname: string; size: number };
const statementBody = {
  schema: {
    type: "object",
    required: ["file", "walletCardId"],
    properties: {
      file: { type: "string", format: "binary" },
      walletCardId: { type: "string", format: "uuid" },
      purchasesAre: { type: "string", enum: ["positive", "negative"] },
    },
  },
};
const upload = () =>
  FileInterceptor("file", {
    limits: { fileSize: MAX_PDF_BYTES, files: 1, fields: 5 },
  });

@ApiTags("spending")
@ApiBearerAuth()
@Controller()
export class SpendController {
  constructor(private readonly spend: SpendService) {}

  @Get("spending/transactions")
  @ApiOperation({ summary: "Transactions with the benefits they updated" })
  list(@CurrentUser() u: AuthUser, @Query() q: SpendListQuery) {
    return this.spend.list(u.sub, q);
  }
  @Get("spending/summary") summary(
    @CurrentUser() u: AuthUser,
    @Query() q: DaysQuery,
  ) {
    return this.spend.summary(u.sub, q);
  }
  @Post("spending/statements/preview")
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Parse a card statement (PDF or CSV) and show what would be imported and matched (nothing is saved)",
  })
  @ApiConsumes("multipart/form-data")
  @ApiBody(statementBody)
  @UseInterceptors(upload())
  preview(
    @CurrentUser() u: AuthUser,
    @Body() dto: StatementDto,
    @UploadedFile() file?: Upload,
  ) {
    return this.spend.previewStatement(
      u.sub,
      dto.walletCardId,
      file,
      dto.purchasesAre,
    );
  }
  @Post("spending/statements")
  @ApiOperation({
    summary:
      "Import a card statement (PDF or CSV); duplicates are skipped and benefits are updated automatically",
  })
  @ApiConsumes("multipart/form-data")
  @ApiBody(statementBody)
  @UseInterceptors(upload())
  importStatement(
    @CurrentUser() u: AuthUser,
    @Body() dto: StatementDto,
    @UploadedFile() file?: Upload,
  ) {
    return this.spend.importStatement(
      u.sub,
      dto.walletCardId,
      file,
      dto.purchasesAre,
    );
  }
  @Post("spending/statements/bulk")
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Import many statements at once (PDF / CSV); each file is matched to its card by the account digits it shows",
  })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["files"],
      properties: {
        files: { type: "array", items: { type: "string", format: "binary" } },
        assignments: { type: "string" },
        purchasesAre: { type: "string", enum: ["positive", "negative"] },
      },
    },
  })
  @UseInterceptors(
    FilesInterceptor("files", MAX_BULK_FILES, {
      limits: { fileSize: MAX_PDF_BYTES, files: MAX_BULK_FILES, fields: 5 },
    }),
  )
  bulk(
    @CurrentUser() u: AuthUser,
    @Body() dto: BulkStatementDto,
    @UploadedFiles() files?: Upload[],
  ) {
    let assignments: Record<string, string> = {};
    if (dto.assignments) {
      try {
        const parsed = JSON.parse(dto.assignments) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
          throw new Error();
        assignments = Object.fromEntries(
          Object.entries(parsed as Record<string, unknown>).filter(
            (e): e is [string, string] =>
              typeof e[1] === "string" && /^[0-9a-f-]{36}$/i.test(e[1]),
          ),
        );
      } catch {
        throw new BadRequestException("assignments must be a JSON object");
      }
    }
    return this.spend.importMany(
      u.sub,
      files ?? [],
      assignments,
      dto.purchasesAre,
    );
  }
  @Post("spending/rescan") @HttpCode(200) rescan(
    @CurrentUser() u: AuthUser,
    @Body() dto: RescanDto,
  ) {
    return this.spend.rescan(u.sub, dto);
  }
  @Put("benefits/:id/auto-tracking") autoTracking(
    @CurrentUser() u: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: AutoTrackingDto,
  ) {
    return this.spend.setRules(u.sub, id, dto);
  }
  @Post("benefits/usages/:usageId/dismiss") @HttpCode(200) dismiss(
    @CurrentUser() u: AuthUser,
    @Param("usageId", ParseUUIDPipe) usageId: string,
  ) {
    return this.spend.dismiss(u.sub, usageId);
  }
}

/** Shared with transactions and bank connections. */
@Module({ providers: [SpendService], exports: [SpendService] })
export class SpendCoreModule {}

@Module({ imports: [SpendCoreModule], controllers: [SpendController] })
export class SpendModule {}
