import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaService } from '../src/prisma/prisma.service';
import { WahaAdapter } from '../src/whatsapp/waha-adapter';
import { WhatsAppConnectionsService } from '../src/whatsapp/whatsapp-connections.service';
import { WhatsAppSessionService } from '../src/whatsapp/whatsapp-session.service';
import {
  pairCentralSession,
  readLinkConfig,
  type LinkConfig,
  type PairingChannel,
} from '../src/whatsapp/whatsapp-link';
import type { WhatsAppSessionStatus } from '../src/whatsapp/whatsapp-provider';

/**
 * Link the central `meper-intelligence` phone session from an operations shell.
 * Wired to the `whatsapp:link` npm script.
 *
 * Why a command and not a route: the central number is one physical phone, and
 * scanning its QR is an operator act that happens once and again only when the
 * phone is unlinked. Requiring a SuperAdmin access token for it coupled a
 * physical pairing ceremony to a browser session, so the token had to be
 * produced by hand every time. This command reads the provider configuration it
 * already needs and asks nothing of MeperPOS: no access token, no login.
 *
 * It reuses `WhatsAppSessionService` and the same `pairCentralSession` rules the
 * platform console uses, so the two surfaces cannot drift. The webhook key is
 * still derived per session, and the observed status is persisted exactly as the
 * HTTP path does it.
 *
 * `--status` only observes. Everything else pairs.
 */

const LOG_PREFIX = '[whatsapp:link]';
const QR_DIRECTORY = join(__dirname, '..', '.tmp');
const QR_FILE = join(QR_DIRECTORY, 'whatsapp-intelligence-qr.png');

/** The central channel as the pairing loop addresses it: never by session name. */
function intelligenceChannel(sessions: WhatsAppSessionService): PairingChannel {
  return {
    connect: () => sessions.connect({ channel: 'INTELLIGENCE' }),
    status: () => sessions.status({ channel: 'INTELLIGENCE' }),
    qr: () => sessions.qr({ channel: 'INTELLIGENCE' }),
  };
}

function buildServices(config: LinkConfig, prisma: PrismaService) {
  const provider = new WahaAdapter({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    webhookUrl: config.webhookUrl,
  });
  const connections = new WhatsAppConnectionsService(prisma);
  const sessions = new WhatsAppSessionService(
    provider,
    connections,
    config.webhookHmacKey,
  );
  return { provider, connections, sessions };
}

async function reportStoredState(prisma: PrismaService): Promise<void> {
  const row = await prisma.whatsAppConnection.findFirst({
    where: { channel: 'INTELLIGENCE' },
    select: { sessionName: true, status: true, accountId: true },
  });
  if (!row) {
    console.log(`${LOG_PREFIX} still no persisted central connection row.`);
    return;
  }
  console.log(`${LOG_PREFIX} session   ${row.sessionName}`);
  console.log(`${LOG_PREFIX} status    ${row.status}`);
  console.log(`${LOG_PREFIX} account   ${row.accountId ?? '(none linked)'}`);
}

async function writeQr(data: string): Promise<void> {
  await mkdir(QR_DIRECTORY, { recursive: true });
  // The image is a pairing credential: readable by its owner only, and removed
  // as soon as the run ends, so a stale code never outlives the operator's turn.
  await writeFile(QR_FILE, Buffer.from(data, 'base64'), { mode: 0o600 });
  console.log(`${LOG_PREFIX} QR written to ${QR_FILE}`);
  console.log(`${LOG_PREFIX} open it and scan it from the central phone.`);
}

async function discardQr(): Promise<void> {
  await rm(QR_FILE, { force: true }).catch(() => undefined);
}

async function subscribe(
  sessions: WhatsAppSessionService,
  prisma: PrismaService,
): Promise<number> {
  let previous: WhatsAppSessionStatus | null = null;
  let result: Awaited<ReturnType<typeof pairCentralSession>>;
  try {
    result = await pairCentralSession(intelligenceChannel(sessions), {
      clock: {
        now: () => Date.now(),
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      },
      onQr: writeQr,
      onStatus: (status) => {
        if (status === previous) return;
        previous = status;
        console.log(`${LOG_PREFIX} status    ${status}`);
      },
    });
  } finally {
    await discardQr();
  }

  await reportStoredState(prisma);

  if (result.ok) {
    console.log(`${LOG_PREFIX} linked: the central session is WORKING.`);
    return 0;
  }
  if (result.reason === 'timeout') {
    console.error(
      `${LOG_PREFIX} no scan within the budget; the session is still ${result.status}. ` +
        `Run the command again when the phone is at hand.`,
    );
    return 1;
  }
  if (result.reason === 'passkey') {
    console.error(
      `${LOG_PREFIX} the provider requires a passkey challenge (${result.status}). ` +
        `Confirm it on the phone, then run the command again.`,
    );
    return 1;
  }
  console.error(
    `${LOG_PREFIX} the session reported ${result.status}. Check the WAHA log for that session.`,
  );
  return 1;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => arg !== '--status' && arg !== '--help');
  if (unknown.length > 0) {
    console.error(`${LOG_PREFIX} unknown argument: ${unknown.join(' ')}`);
    console.error(`${LOG_PREFIX} usage: whatsapp-link [--status]`);
    return 1;
  }
  if (args.includes('--help')) {
    console.log(`${LOG_PREFIX} usage: whatsapp-link [--status]`);
    console.log(
      `${LOG_PREFIX} pairs the central intelligence session; no MeperPOS login needed.`,
    );
    return 0;
  }

  const config = readLinkConfig(process.env);
  if (!config.ok) {
    console.error(
      `${LOG_PREFIX} missing provider configuration: ${config.missing.join(', ')}`,
    );
    return 1;
  }

  const prisma = new PrismaService();
  try {
    const { sessions } = buildServices(config.config, prisma);
    console.log(
      `${LOG_PREFIX} provider  ${new URL(config.config.baseUrl).host}`,
    );
    if (args.includes('--status')) {
      const { status } = await sessions.status({ channel: 'INTELLIGENCE' });
      console.log(`${LOG_PREFIX} status    ${status}`);
      await reportStoredState(prisma);
      return 0;
    }
    return await subscribe(sessions, prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(
      `${LOG_PREFIX} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
