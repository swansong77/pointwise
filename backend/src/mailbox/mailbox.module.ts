import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { CaptureCoreModule } from '../capture/capture.module';
import { AuthUser, CurrentUser, MemberSafe, Public } from '../common/decorators';
import { MailboxService } from './mailbox.service';

export class ConnectMailboxDto {
  @ApiProperty({ example: 'Personal mail' }) @IsString() @MinLength(1) @MaxLength(60) label: string;
  @ApiProperty({ example: 'imap.example.com' }) @IsString() @MinLength(3) @MaxLength(253) host: string;
  @ApiPropertyOptional({ default: 993 }) @IsOptional() @IsInt() @Min(1) @Max(65535) port?: number;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(254) username: string;
  @ApiProperty({ description: 'An app password (not your main password). Stored encrypted; never returned.' }) @IsString() @MinLength(1) @MaxLength(200) password: string;
  @ApiPropertyOptional({ default: 'INBOX' }) @IsOptional() @IsString() @MaxLength(100) folder?: string;
  @ApiPropertyOptional({ description: 'The household member this mailbox feeds (owners only). Omit for the whole household.' }) @IsOptional() @IsUUID() profileId?: string;
}

@ApiTags('mailboxes')
@ApiBearerAuth()
// a household member manages their own mailboxes here: they are their own channel (their user id), pinned to their profile
@MemberSafe()
@Controller('mailboxes')
export class MailboxController {
  constructor(private readonly svc: MailboxService) {}

  /** Which sign-in options the server offers (Gmail / Outlook need the owner's own client id and secret). */
  @Get('providers') providers() {
    return this.svc.providers();
  }
  /** Starts Gmail ("google") or Outlook ("microsoft") sign-in: returns the provider's consent URL. */
  @Get('oauth/:provider/start') start(@CurrentUser() u: AuthUser, @Param('provider') provider: string, @Query('profileId') profileId?: string) {
    return this.svc.startOAuth(u.sub, provider, profileId);
  }
  /** The provider redirects the browser here; the sealed `state` identifies the user, so no bearer token is needed. */
  @Public() @Get('oauth/callback') async callback(@Query('code') code: string | undefined, @Query('state') state: string | undefined, @Query('error') error: string | undefined, @Res() res: Response) {
    const r = await this.svc.finishOAuth(code, state, error);
    const base = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
    res.redirect(302, `${base}${r.member ? '/my/mail' : '/spending'}?mailbox=${r.ok ? 'connected' : `error&reason=${encodeURIComponent(r.message ?? 'failed')}`}`);
  }
  @Get() list(@CurrentUser() u: AuthUser) {
    return this.svc.list(u.sub);
  }
  @Post() connect(@CurrentUser() u: AuthUser, @Body() dto: ConnectMailboxDto) {
    return this.svc.connect(u.sub, dto);
  }
  @Post(':id/sync') @HttpCode(200) sync(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.syncNow(u.sub, id);
  }
  @Delete(':id') @HttpCode(204) remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.disconnect(u.sub, id);
  }
}

@Module({ imports: [CaptureCoreModule], providers: [MailboxService], exports: [MailboxService] })
export class MailboxCoreModule {}

@Module({ imports: [MailboxCoreModule], controllers: [MailboxController] })
export class MailboxModule {}
