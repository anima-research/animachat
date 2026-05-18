#!/usr/bin/env node
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  ClaudeArchiveContentMode,
  getDefaultClaudeArchiveModel,
  importClaudeArchive,
  previewClaudeArchive
} from '../src/services/claudeArchiveImporter.js';

interface Options {
  file?: string;
  email?: string;
  userId?: string;
  model: string;
  dryRun: boolean;
  limit?: number;
  skipEmpty: boolean;
  contentMode: ClaudeArchiveContentMode;
}

function usage(): never {
  console.error(`Usage:
  npm run import:claude-archive -- --file /path/to/conversations.json --email you@example.com [options]

Options:
  --file <path>                 Claude.ai conversations.json export
  --email <email>               Arc user email to import into
  --user-id <uuid>              Arc user id to import into
  --model <model-id>            Conversation model id (default: ${getDefaultClaudeArchiveModel()})
  --limit <n>                   Import at most n non-empty conversations
  --include-empty               Create conversations that have no messages
  --content <mode>              rendered, text-blocks, or verbose-blocks (default: rendered)
  --dry-run                     Parse and summarize without writing data

Notes:
  This command is not idempotent. Re-running it will create another copy of each conversation.
  Run it from anywhere; it writes to backend/data relative to this package.`);
  process.exit(1);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    model: getDefaultClaudeArchiveModel(),
    dryRun: false,
    skipEmpty: true,
    contentMode: 'rendered'
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (!value) usage();
      return value;
    };

    switch (arg) {
      case '--file':
        options.file = next();
        break;
      case '--email':
        options.email = next().toLowerCase();
        break;
      case '--user-id':
        options.userId = next();
        break;
      case '--model':
        options.model = next();
        break;
      case '--limit':
        options.limit = Number(next());
        if (!Number.isInteger(options.limit) || options.limit < 1) usage();
        break;
      case '--include-empty':
        options.skipEmpty = false;
        break;
      case '--content': {
        const mode = next();
        if (mode !== 'rendered' && mode !== 'text-blocks' && mode !== 'verbose-blocks') usage();
        options.contentMode = mode;
        break;
      }
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--help':
      case '-h':
        usage();
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        usage();
    }
  }

  if (!options.file) usage();
  if (!options.dryRun && !options.email && !options.userId) {
    console.error('Either --email or --user-id is required unless --dry-run is set.');
    usage();
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const backendRoot = path.resolve(scriptDir, '..');
  const archivePath = path.resolve(options.file!);

  process.chdir(backendRoot);
  dotenv.config({ path: path.join(backendRoot, '.env') });

  const preview = previewClaudeArchive(archivePath, {
    skipEmpty: options.skipEmpty,
    limit: options.limit
  });

  console.log(`[Claude archive import] Archive: ${archivePath}`);
  console.log(`[Claude archive import] Selected conversations: ${preview.selectedConversations} of ${preview.totalConversations}`);
  console.log(`[Claude archive import] Source messages: ${preview.totalMessages}`);
  console.log(`[Claude archive import] Content mode: ${options.contentMode}`);

  if (options.dryRun) {
    console.log(`[Claude archive import] Dry run only. Branchy conversations: ${preview.branchyConversations}`);
    for (const conversation of preview.samples) {
      console.log(`  - ${conversation.uuid} | ${conversation.title} | ${conversation.messageCount} messages`);
    }
    return;
  }

  const { Database } = await import('../src/database/index.js');
  const db = new Database();
  await db.init();

  const user = options.email
    ? await db.getUserByEmail(options.email)
    : await db.getUserById(options.userId!);
  if (!user) {
    throw new Error(options.email ? `No user found with email ${options.email}` : `No user found with id ${options.userId}`);
  }

  const result = await importClaudeArchive(db, archivePath, user.id, {
    model: options.model,
    skipEmpty: options.skipEmpty,
    limit: options.limit,
    contentMode: options.contentMode,
    onProgress: progress => {
      if (progress.importedConversations % 25 === 0) {
        console.log(`[Claude archive import] Imported ${progress.importedConversations}/${progress.totalConversations} conversations...`);
      }
    }
  });

  console.log('[Claude archive import] Done.');
  console.log(`  User: ${user.email} (${user.id})`);
  console.log(`  Conversations imported: ${result.importedConversations}`);
  console.log(`  Conversations skipped: ${result.skippedConversations}`);
  console.log(`  Arc messages created: ${result.importedMessages}`);
  console.log(`  Arc branches created: ${result.importedBranches}`);
}

main().catch(error => {
  console.error('[Claude archive import] Failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
