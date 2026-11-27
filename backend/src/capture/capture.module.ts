import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiExcludeEndpoint,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import { IsBoolean, IsOptional, IsUUID } from "class-validator";
import type { Request } from "express";
import { AuthUser, CurrentUser, MemberSafe, Public } from "../common/decorators";
import { SpendCoreModule } from "../spend/spend.module";
import { LoyaltyIngestModule } from "../loyalty/loyalty-ingest.service";
import { CaptureService } from "./capture.service";
import { OfferAutomationCoreModule } from "../offer-automation/offer-automation.module";

export class InboxDto {
  @ApiProperty() @IsBoolean() enabled: boolean;
}
export class AssignDto {
  @ApiProperty() @IsUUID() walletCardId: string;
  @ApiPropertyOptional({
    description:
      "Save the alert's last digits on the card so later alerts are matched automatically",
  })
  @IsOptional()
  @IsBoolean()
  remember?: boolean;
}

@ApiTags("capture")
@Controller()
export class CaptureController {
  constructor(private readonly capture: CaptureService) {}

  /**
   * Inbound mail webhook (Cloudflare Email Workers, Amazon SES, Mailgun, Postmark … forward the raw
   * MIME message). Authenticated with the shared INBOUND_EMAIL_SECRET header; the recipient comes
   * from X-Envelope-To / ?to= (or the message headers).
   */
  @Public()
  @SkipThrottle()
  @Post("inbound/email")
  @HttpCode(202)
  @ApiExcludeEndpoint()
  async inbound(
    @Req() req: Request,
    @Headers("x-inbound-secret") secret: string | undefined,
    @Headers("x-envelope-to") envelopeTo: string | undefined,
    @Query("to") to: string | undefined,
  ) {
    if (!this.capture.checkSecret(secret)) throw new UnauthorizedException();
    const body = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(typeof req.body === "string" ? req.body : "");
    if (!body.length) return { accepted: false };
    return this.capture.receive(
      body,
      [envelopeTo ?? "", to ?? ""].filter(Boolean),
    );
  }

  @ApiBearerAuth()
  @MemberSafe()
  @Get("capture/status")
  @ApiOperation({
    summary:
      "How each card's transactions arrive automatically; forwarding address; items to review",
  })
  status(@CurrentUser() u: AuthUser) {
    return this.capture.status(u.sub);
  }
  @ApiBearerAuth() @MemberSafe() @Patch("capture/inbox") inbox(
    @CurrentUser() u: AuthUser,
    @Body() dto: InboxDto,
  ) {
    return this.capture.setEnabled(u.sub, dto.enabled);
  }
  @ApiBearerAuth()
  @MemberSafe()
  @Post("capture/inbox/rotate")
  @HttpCode(200)
  @ApiOperation({
    summary: "New forwarding address (the old one stops working)",
  })
  rotate(@CurrentUser() u: AuthUser) {
    return this.capture.rotate(u.sub);
  }
  @ApiBearerAuth() @MemberSafe() @Post("capture/items/:id/assign") @HttpCode(200) assign(
    @CurrentUser() u: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: AssignDto,
  ) {
    return this.capture.assign(u.sub, id, dto.walletCardId, !!dto.remember);
  }
  @ApiBearerAuth() @MemberSafe() @Delete("capture/items/:id") @HttpCode(204) discard(
    @CurrentUser() u: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.capture.discard(u.sub, id);
  }
}

/** Shared by the API, the mailbox connector and the worker (no controllers). */
@Module({ imports: [SpendCoreModule, LoyaltyIngestModule, OfferAutomationCoreModule], providers: [CaptureService], exports: [CaptureService] })
export class CaptureCoreModule {}

@Module({ imports: [CaptureCoreModule], controllers: [CaptureController] })
export class CaptureModule {}
