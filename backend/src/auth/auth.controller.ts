import { Body, Controller, Get, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators';
import { AuthService } from './auth.service';
import { AcceptInviteDto, ForgotPasswordDto, LoginDto, OAuthExchangeDto, RefreshDto, RegisterDto, ResetPasswordDto, TokenPairDto } from './dto/auth.dto';

@ApiTags('auth')
@Public()
@Throttle({ default: { limit: Number(process.env.AUTH_RATE_LIMIT_PER_MIN ?? 10), ttl: 60_000 } })
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @ApiOkResponse({ type: TokenPairDto })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  @HttpCode(200)
  @ApiOkResponse({ type: TokenPairDto })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiOkResponse({ type: TokenPairDto })
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Body() dto: RefreshDto) {
    await this.auth.logout(dto.refreshToken);
  }

  @Post('oauth')
  @HttpCode(200)
  @ApiHeader({ name: 'x-internal-secret', required: true, description: 'Shared secret between NextAuth and the API' })
  @ApiOkResponse({ type: TokenPairDto })
  oauth(@Body() dto: OAuthExchangeDto, @Headers('x-internal-secret') secret?: string) {
    return this.auth.oauthExchange(dto, secret);
  }

  @Get('invite/:token')
  inviteInfo(@Param('token') token: string) {
    return this.auth.inviteInfo(token);
  }

  @Post('accept-invite')
  @HttpCode(200)
  @ApiOkResponse({ type: TokenPairDto })
  acceptInvite(@Body() dto: AcceptInviteDto) {
    return this.auth.acceptInvite(dto);
  }

  @Post('forgot-password')
  @HttpCode(202)
  async forgot(@Body() dto: ForgotPasswordDto) {
    await this.auth.forgotPassword(dto.email);
    return { message: 'If that account exists, a reset email has been sent.' };
  }

  @Post('reset-password')
  @HttpCode(204)
  async reset(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto.token, dto.password);
  }
}
