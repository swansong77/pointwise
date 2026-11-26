/**
 * Command line for operators: back up, verify, restore, check a server before and after a migration, and move one
 * member's data. Runs inside the backend container (node dist/cli/pointwise-admin.js ...) without starting the web server.
 * Passphrases are read from the environment (PW_PASSPHRASE, else BACKUP_PASSPHRASE), never from the command line.
 */
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { readFileSync, writeFileSync } from 'fs';
import { PrismaModule, PrismaService } from '../common/prisma.service';
import { BackupService } from '../data/backup.service';
import { DataCoreModule } from '../data/data.module';
import { MaintenanceService } from '../data/maintenance.service';
import { MigrationService } from '../data/migration.service';
import { RestoreService } from '../data/restore.service';
import { UserBundleService } from '../data/user-bundle.service';

@Module({ imports: [PrismaModule, DataCoreModule] })
class CliModule {}

const USAGE = `pointwise-admin <command>

  preflight                              check this server before restoring onto it
  backup [--ephemeral] [--env]           write an encrypted backup to the backup folder
  verify <file>                          check a backup (passphrase, checksums, version) without restoring
  restore <file> --yes [--keep-maintenance] [--write-env <path>]
                                         replace ALL data with the backup (a pre-restore backup is made first)
  verify-restored                        after a restore: references, secrets, administrator
  maintenance on|off [reason]            turn maintenance mode on or off
  export-user <email> <out> [--gzip]     write one member's data file
  import-user <email> <file> --mode merge|replace [--apply]
                                         preview (default) or apply a member's data file

Passphrase: PW_PASSPHRASE (or BACKUP_PASSPHRASE) in the environment.`;

const flag = (args: string[], f: string) => args.includes(f);
const value = (args: string[], f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const pass = () => {
  const p = process.env.PW_PASSPHRASE || process.env.BACKUP_PASSPHRASE;
  if (!p) throw new Error('Set PW_PASSPHRASE (or BACKUP_PASSPHRASE) in the environment.');
  return p;
};
const print = (v: unknown) => console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));

async function main(): Promise<number> {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd || cmd === '--help' || cmd === 'help') {
    print(USAGE);
    return cmd ? 0 : 1;
  }
  const app = await NestFactory.createApplicationContext(CliModule, { logger: ['error', 'warn'] });
  try {
    const backups = app.get(BackupService);
    switch (cmd) {
      case 'preflight': {
        const checks = await app.get(MigrationService).preflight();
        checks.forEach((c) => print(`${c.status.toUpperCase().padEnd(4)} ${c.label}: ${c.detail}`));
        print('\nEnvironment to review on the new server:');
        app.get(MigrationService).envManifest().forEach((e) => print(`  ${e.kind === 'carry' ? 'carry ' : 'review'} ${e.name} (${e.state})${e.value ? ` = ${e.value}` : ''} ${e.note}`));
        return checks.some((c) => c.status === 'fail') ? 1 : 0;
      }
      case 'backup': {
        const r = await backups.create({ passphrase: pass(), includeEphemeral: flag(args, '--ephemeral'), includeEnv: flag(args, '--env') });
        print({ file: `${backups.dir()}/${r.name}`, bytes: r.bytes, rows: r.manifest.totalRows, warnings: r.manifest.warnings });
        return 0;
      }
      case 'verify': {
        if (!args[0]) throw new Error('verify <file>');
        const file = args[0].includes('/') ? args[0] : backups.pathOf(args[0]);
        const r = await backups.verifyFile(file, pass());
        print({ ok: r.ok, createdAt: r.header?.createdAt, migration: r.header?.migration, rows: r.manifest?.totalRows, hasEnv: r.hasEnv, problems: r.problems, incompatible: r.incompatible });
        return r.ok && !r.incompatible ? 0 : 1;
      }
      case 'restore': {
        if (!args[0]) throw new Error('restore <file> --yes');
        if (!flag(args, '--yes')) throw new Error('This replaces ALL data on this server. Add --yes to confirm.');
        const r = await app.get(RestoreService).restore({ file: args[0], passphrase: pass(), keepMaintenance: flag(args, '--keep-maintenance') });
        const envPath = value(args, '--write-env');
        if (envPath && r.env) {
          writeFileSync(envPath, Object.entries(r.env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
          print(`Environment secrets written to ${envPath} (mode 600). Move them into the new server's environment and delete the file.`);
        }
        print({ rows: r.rows, models: r.models, seconds: Math.round(r.millis / 1000), preBackup: r.preBackup, warnings: r.warnings, carriedEnv: r.env ? Object.keys(r.env) : [] });
        return 0;
      }
      case 'verify-restored': {
        const checks = await app.get(MigrationService).verifyRestored();
        checks.forEach((c) => print(`${c.status.toUpperCase().padEnd(4)} ${c.label}: ${c.detail}`));
        print(checks.some((c) => c.status === 'fail') ? 'NOT VERIFIED' : 'verified');
        return checks.some((c) => c.status === 'fail') ? 1 : 0;
      }
      case 'maintenance': {
        const on = args[0] === 'on';
        if (!['on', 'off'].includes(args[0] ?? '')) throw new Error('maintenance on|off [reason]');
        print(await app.get(MaintenanceService).set(on, null, args.slice(1).join(' ') || undefined));
        return 0;
      }
      case 'export-user': {
        if (!args[0] || !args[1]) throw new Error('export-user <email> <out> [--gzip]');
        const user = await app.get(PrismaService).user.findUnique({ where: { email: args[0].toLowerCase() } });
        if (!user) throw new Error('No member with that email.');
        const svc = app.get(UserBundleService);
        const bundle = await svc.build(user.id);
        writeFileSync(args[1], svc.toFile(bundle, flag(args, '--gzip')), { mode: 0o600 });
        print({ file: args[1], counts: bundle.counts, needsReconnect: bundle.needsReconnect });
        return 0;
      }
      case 'import-user': {
        if (!args[0] || !args[1]) throw new Error('import-user <email> <file> --mode merge|replace [--apply]');
        const mode = value(args, '--mode') === 'replace' ? 'replace' : 'merge';
        const user = await app.get(PrismaService).user.findUnique({ where: { email: args[0].toLowerCase() } });
        if (!user) throw new Error('No member with that email.');
        const svc = app.get(UserBundleService);
        print(await svc.apply(user.id, svc.parse(readFileSync(args[1])), mode, !flag(args, '--apply')));
        return 0;
      }
      default:
        print(USAGE);
        return 1;
    }
  } finally {
    await app.close();
  }
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(2);
  },
);
