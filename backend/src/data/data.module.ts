import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { Response } from 'express';
import { createReadStream, existsSync, mkdirSync, renameSync } from 'fs';
import { diskStorage } from 'multer';
import { join } from 'path';
import { AuthUser, CurrentUser, Roles } from '../common/decorators';
import { RolesGuard } from '../common/guards';
import { PrismaService } from '../common/prisma.service';
import { NotificationsModule, NotificationsService } from '../notifications/notifications.service';
import { BackupService } from './backup.service';
import { MaintenanceGuard, MaintenanceService } from './maintenance.service';
import { MigrationService } from './migration.service';
import { RestoreService } from './restore.service';
import { MAX_BUNDLE_BYTES, UserBundleService } from './user-bundle.service';

export class CreateBackupDto {
  @ApiProperty({ description: 'at least 12 characters; never stored. Without it the backup cannot be read.' }) @IsString() @MinLength(12) @MaxLength(200) passphrase: string;
  @ApiPropertyOptional({ description: 'also include sessions, notifications, analytics and agent runs' }) @IsOptional() @IsBoolean() includeEphemeral?: boolean;
  @ApiPropertyOptional({ description: 'carry the environment secrets that keep sessions and push alive (inside the encrypted file)' }) @IsOptional() @IsBoolean() includeEnv?: boolean;
}
export class PassphraseDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) passphrase: string;
}
export class RestoreDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) passphrase: string;
  @ApiProperty({ description: 'type RESTORE to confirm that all current data will be replaced' }) @IsIn(['RESTORE']) confirm: 'RESTORE';
  @ApiPropertyOptional() @IsOptional() @IsBoolean() keepMaintenance?: boolean;
}
export class MaintenanceDto {
  @ApiProperty() @IsBoolean() on: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

const MAX_BACKUP_UPLOAD = Number(process.env.BACKUP_MAX_MB ?? 2048) * 1_048_576;

@Injectable()
export class DataAudit {
  constructor(private readonly prisma: PrismaService) {}
  async write(actorId: string, action: string, entity: string, entityId: string, diff?: Record<string, unknown>) {
    await this.prisma.auditLog.create({ data: { actorId, action, entity, entityId, diff: diff as never } });
  }
}

/** Administrators: backups, restore, maintenance mode and the migration checks. */
@ApiTags('admin-data')
@ApiBearerAuth()
@Roles('ADMIN')
@UseGuards(RolesGuard)
@Controller('admin')
export class AdminDataController {
  constructor(
    private readonly backups: BackupService,
    private readonly restores: RestoreService,
    private readonly maintenance: MaintenanceService,
    private readonly migration: MigrationService,
    private readonly audit: DataAudit,
  ) {}

  @Get('backups') async list() {
    return {
      files: this.backups.list(),
      folder: this.backups.dir(),
      keep: Number(process.env.BACKUP_KEEP ?? 7),
      nightly: { configured: !!process.env.BACKUP_PASSPHRASE, schedule: '03:30 UTC' },
      migration: await this.backups.migration(),
      maintenance: await this.maintenance.get(),
    };
  }

  @Post('backups') async create(@CurrentUser() u: AuthUser, @Body() dto: CreateBackupDto) {
    const r = await this.backups.create({ passphrase: dto.passphrase, includeEphemeral: dto.includeEphemeral, includeEnv: dto.includeEnv });
    await this.audit.write(u.sub, 'backup.create', 'Backup', r.name, { rows: r.manifest.totalRows, bytes: r.bytes, ephemeral: !!dto.includeEphemeral, env: !!dto.includeEnv, warnings: r.manifest.warnings.length });
    return { name: r.name, bytes: r.bytes, rows: r.manifest.totalRows, warnings: r.manifest.warnings };
  }

  @Post('backups/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_BACKUP_UPLOAD, files: 1, fields: 2 },
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const d = process.env.BACKUP_DIR || '/var/backups/pointwise';
          if (!existsSync(d)) mkdirSync(d, { recursive: true, mode: 0o700 });
          cb(null, d);
        },
        filename: (_req, _file, cb) => cb(null, `uploaded-${Date.now()}.pwbackup.partial`),
      }),
    }),
  )
  async upload(@CurrentUser() u: AuthUser, @UploadedFile() file?: { path: string; size: number }) {
    if (!file) throw new BadRequestException('Choose a backup file.');
    const name = `uploaded-${Date.now()}.pwbackup`;
    renameSync(file.path, join(this.backups.dir(), name));
    await this.audit.write(u.sub, 'backup.upload', 'Backup', name, { bytes: file.size });
    return { name, bytes: file.size };
  }

  @Get('backups/:name/download') async download(@CurrentUser() u: AuthUser, @Param('name') name: string, @Res() res: Response) {
    const p = this.backups.pathOf(name);
    await this.audit.write(u.sub, 'backup.download', 'Backup', name);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    createReadStream(p).pipe(res);
  }

  @Post('backups/:name/verify') async verify(@Param('name') name: string, @Body() dto: PassphraseDto) {
    const r = await this.backups.verifyFile(this.backups.pathOf(name), dto.passphrase);
    return { ok: r.ok, createdAt: r.header?.createdAt ?? null, appVersion: r.header?.appVersion ?? null, migration: r.header?.migration ?? null, rows: r.manifest?.totalRows ?? null, models: r.header?.models.length ?? null, hasEnv: r.hasEnv, includesEphemeral: r.header?.includesEphemeral ?? null, warnings: r.manifest?.warnings ?? [], problems: r.problems, incompatible: r.incompatible };
  }

  @Post('backups/:name/restore') async restore(@CurrentUser() u: AuthUser, @Param('name') name: string, @Body() dto: RestoreDto) {
    const r = await this.restores.restore({ file: name, passphrase: dto.passphrase, keepMaintenance: dto.keepMaintenance });
    // the restore replaced every table, including the audit log; record it if the administrator still exists
    await this.audit.write(u.sub, 'backup.restore', 'Backup', name, { rows: r.rows, preBackup: r.preBackup }).catch(() => undefined);
    return { rows: r.rows, models: r.models, seconds: Math.round(r.millis / 1000), preBackup: r.preBackup, warnings: r.warnings, carriedEnv: r.env ? Object.keys(r.env) : [] };
  }

  @Delete('backups/:name') @HttpCode(204) async remove(@CurrentUser() u: AuthUser, @Param('name') name: string) {
    this.backups.remove(name);
    await this.audit.write(u.sub, 'backup.delete', 'Backup', name);
  }

  @Get('maintenance') state() {
    return this.maintenance.get();
  }

  @Post('maintenance') async setMaintenance(@CurrentUser() u: AuthUser, @Body() dto: MaintenanceDto) {
    const s = await this.maintenance.set(dto.on, u.sub, dto.reason);
    await this.audit.write(u.sub, dto.on ? 'maintenance.on' : 'maintenance.off', 'System', 'maintenance', { reason: dto.reason ?? null });
    return s;
  }

  @Get('migration/preflight') preflight() {
    return this.migration.preflight();
  }

  @Get('migration/env') env() {
    return this.migration.envManifest();
  }

  @Get('migration/verify') verifyRestored() {
    return this.migration.verifyRestored();
  }
}

/** Members: their own data and settings, out and back in. */
@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeDataController {
  constructor(
    private readonly bundles: UserBundleService,
    private readonly audit: DataAudit,
  ) {}

  @Get('data-export') async export(@CurrentUser() u: AuthUser, @Query('gzip') gzip: string | undefined, @Res() res: Response) {
    const bundle = await this.bundles.build(u.sub);
    const zip = gzip === 'true';
    const file = this.bundles.toFile(bundle, zip);
    await this.audit.write(u.sub, 'user.data-export', 'User', u.sub, { rows: Object.values(bundle.counts).reduce((s, n) => s + n, 0), gzip: zip });
    res.setHeader('Content-Type', zip ? 'application/gzip' : 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="pointwise-data-${bundle.exportedAt.slice(0, 10)}.pointwise-data.json${zip ? '.gz' : ''}"`);
    res.end(file);
  }

  @Post('data-import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BUNDLE_BYTES, files: 1, fields: 4 } }))
  async import(@CurrentUser() u: AuthUser, @UploadedFile() file: { buffer: Buffer } | undefined, @Body() body: { mode?: string; dryRun?: string }) {
    if (!file?.buffer) throw new BadRequestException('Choose a PointWise data file.');
    const mode = body.mode === 'replace' ? 'replace' : body.mode === 'merge' || body.mode === undefined ? 'merge' : null;
    if (!mode) throw new BadRequestException('Mode must be merge or replace.');
    const dryRun = body.dryRun !== 'false';
    const bundle = this.bundles.parse(file.buffer);
    const report = await this.bundles.apply(u.sub, bundle, mode, dryRun);
    if (!dryRun) await this.audit.write(u.sub, 'user.data-import', 'User', u.sub, { mode, ...report.totals });
    return report;
  }
}

/** The pieces the CLI and the API share (no controllers, no notifications). */
@Module({
  providers: [MaintenanceService, BackupService, RestoreService, MigrationService, UserBundleService, DataAudit],
  exports: [MaintenanceService, BackupService, RestoreService, MigrationService, UserBundleService, DataAudit],
})
export class DataCoreModule {}

@Injectable()
export class BackupJobs {
  constructor(
    private readonly prisma: PrismaService,
    private readonly backups: BackupService,
    private readonly notifications: NotificationsService,
  ) {}

  /** The nightly backup: only when BACKUP_PASSPHRASE is set. Keeps the newest BACKUP_KEEP. A failure notifies the administrators. */
  async nightly(now: Date): Promise<number> {
    const passphrase = process.env.BACKUP_PASSPHRASE;
    if (!passphrase) return 0;
    const admin = await this.prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    try {
      const r = await this.backups.create({ passphrase, includeEphemeral: process.env.BACKUP_INCLUDE_EPHEMERAL === 'true' });
      const pruned = this.backups.prune(Number(process.env.BACKUP_KEEP ?? 7));
      if (admin) await this.prisma.auditLog.create({ data: { actorId: admin.id, action: 'backup.nightly', entity: 'Backup', entityId: r.name, diff: { rows: r.manifest.totalRows, bytes: r.bytes, pruned: pruned.length } } });
      return 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message.slice(0, 200) : 'unknown error';
      const admins = await this.prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
      for (const a of admins) await this.notifications.notify(a.id, 'BACKUP_FAILED', 'The nightly backup failed', msg, '/admin/backup', `backup-failed:${now.toISOString().slice(0, 10)}`);
      return 0;
    }
  }
}

@Module({ imports: [DataCoreModule, NotificationsModule], providers: [BackupJobs], exports: [BackupJobs, DataCoreModule] })
export class DataJobsModule {}

@Module({ imports: [DataCoreModule], controllers: [AdminDataController, MeDataController], exports: [DataCoreModule] })
export class DataModule {}

export { MaintenanceGuard };
