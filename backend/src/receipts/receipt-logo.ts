import { promises as files, constants } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { v2 as cloudinary } from 'cloudinary';

const MAX_LOGO_BYTES = 1024 * 1024;
const LOGO_TIMEOUT_MS = 3000;

export interface ReceiptLogo {
  bytes: Uint8Array;
  format: 'PNG' | 'JPEG';
  width: number;
  height: number;
}

function hasJpegFrame(
  bytes: Buffer,
): { width: number; height: number } | undefined {
  if (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9)
    return;
  let offset = 2;
  let dimensions: { width: number; height: number } | undefined;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset++] !== 0xff) return;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (offset + 2 > bytes.length) return;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return;
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 11) return;
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      const channels = bytes[offset + 7];
      if (
        !width ||
        !height ||
        width * height > 4_000_000 ||
        ![1, 3, 4].includes(channels) ||
        length !== 8 + 3 * channels
      )
        return;
      dimensions = { width, height };
    }
    if (marker === 0xda)
      return dimensions && length >= 8 && offset + length < bytes.length - 2
        ? dimensions
        : undefined;
    offset += length;
  }
  return;
}

function detectLogo(bytes: Buffer): ReceiptLogo | undefined {
  if (bytes.length > MAX_LOGO_BYTES) return;
  if (
    bytes.length >= 24 &&
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.toString('ascii', 12, 16) === 'IHDR'
  ) {
    // Bound decompression work as well as the downloaded size.
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if (!width || !height || width * height > 4_000_000) return;
    return { bytes: new Uint8Array(bytes), format: 'PNG', width, height };
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    const dimensions = hasJpegFrame(bytes);
    if (dimensions)
      return {
        bytes: new Uint8Array(bytes),
        format: 'JPEG',
        ...dimensions,
      };
  }
}

function rasterDimensions(
  bytes: Buffer,
):
  | { format: 'GIF89A' | 'GIF87A' | 'WEBP'; width: number; height: number }
  | undefined {
  const gif = bytes.toString('ascii', 0, 6).toUpperCase();
  if (bytes.length >= 13 && (gif === 'GIF89A' || gif === 'GIF87A')) {
    return {
      format: gif,
      width: bytes.readUInt16LE(6),
      height: bytes.readUInt16LE(8),
    };
  }
  if (
    bytes.length < 30 ||
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.toString('ascii', 8, 12) !== 'WEBP' ||
    bytes.readUInt32LE(4) + 8 !== bytes.length
  )
    return;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunk = bytes.toString('ascii', offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + length > bytes.length) return;
    if (chunk === 'VP8X' && length >= 10) {
      return {
        format: 'WEBP',
        width: 1 + bytes.readUIntLE(start + 4, 3),
        height: 1 + bytes.readUIntLE(start + 7, 3),
      };
    }
    if (chunk === 'VP8L' && length >= 5 && bytes[start] === 0x2f) {
      const bits = bytes.readUInt32LE(start + 1);
      return {
        format: 'WEBP',
        width: 1 + (bits & 0x3fff),
        height: 1 + ((bits >>> 14) & 0x3fff),
      };
    }
    if (
      chunk === 'VP8 ' &&
      length >= 10 &&
      bytes.toString('hex', start + 3, start + 6) === '9d012a'
    ) {
      return {
        format: 'WEBP',
        width: bytes.readUInt16LE(start + 6) & 0x3fff,
        height: bytes.readUInt16LE(start + 8) & 0x3fff,
      };
    }
    offset = start + length + (length % 2);
  }
}

// Native rasterization runs in a process, not a thread: SIGKILL interrupts even
// synchronous Rust/decoder work. The script is server-owned, never SVG code.
function rendererScript(): string {
  return String.raw`
    const MAX_LOGO_BYTES = ${MAX_LOGO_BYTES};
    const hasJpegFrame = ${hasJpegFrame.toString()};
    const detectLogo = ${detectLogo.toString()};
    const rasterDimensions = ${rasterDimensions.toString()};
    const chunks = [];
    let size = 0;
    process.stdin.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_LOGO_BYTES) process.exit(1);
      chunks.push(chunk);
    });
    process.stdin.on('end', () => {
      try {
        const bytes = Buffer.concat(chunks);
        const format = process.argv[1];
        let output;
        if (format === 'SVG') {
          const { SaxesParser } = require(${JSON.stringify(require.resolve('saxes'))});
          const parser = new SaxesParser({ xmlns: true });
          let elements = 0, style = false, css = '';
          function checkCss(value) {
            const clean = value.replace(/\/\*[\s\S]*?\*\//g, '');
            if (/[\\@]/.test(clean)) throw Error('external CSS');
            const internal = clean.replace(/url\(\s*(['"]?)#[A-Za-z_][\w:.-]*\1\s*\)/gi, '');
            if (/url\s*\(/i.test(internal)) throw Error('external CSS URL');
          }
          parser.on('error', error => { throw error; });
          parser.on('doctype', () => { throw Error('DTD denied'); });
          parser.on('processinginstruction', () => { throw Error('processing instruction denied'); });
          parser.on('opentag', node => {
            if (style) throw Error('nested stylesheet markup');
            if (++elements > 4096) throw Error('SVG complexity');
            if (elements === 1 && (node.local !== 'svg' || node.uri !== 'http://www.w3.org/2000/svg')) throw Error('not SVG');
            if (/^(script|foreignObject)$/i.test(node.local)) throw Error('active SVG');
            if (Object.keys(node.attributes).length > 64) throw Error('SVG attributes');
            for (const attr of Object.values(node.attributes)) {
              if (/^on/i.test(attr.local) || attr.local === 'base') throw Error('active attribute');
              if (attr.local.toLowerCase() === 'href') {
                if (/^#[A-Za-z_][\w:.-]*$/.test(attr.value) && !/^(image|feImage)$/i.test(node.local)) continue;
                const image = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(attr.value);
                if (!image || !/^(image|feImage)$/i.test(node.local)) throw Error('external image');
                const logo = detectLogo(Buffer.from(image[2], 'base64'));
                if (!logo || logo.format !== (image[1] === 'png' ? 'PNG' : 'JPEG')) throw Error('invalid embedded image');
              }
              if (attr.local === 'style' || /url\s*\(/i.test(attr.value) || attr.value.includes('\\')) checkCss(attr.value);
            }
            style = node.local === 'style';
          });
          parser.on('text', value => { if (style) css += value; });
          parser.on('cdata', value => { if (style) css += value; });
          parser.on('closetag', node => { if (node.local === 'style') { checkCss(css); css = ''; style = false; } });
          parser.write(bytes.toString('utf8')).close();
          const { Resvg } = require(${JSON.stringify(require.resolve('@resvg/resvg-js'))});
          const options = { font: { loadSystemFonts: false, fontFiles: [], fontDirs: [] }, logLevel: 'off' };
          const parsed = new Resvg(bytes, options);
          if (!Number.isFinite(parsed.width) || !Number.isFinite(parsed.height) || parsed.width <= 0 || parsed.height <= 0 || parsed.width * parsed.height > 4000000) throw Error('SVG dimensions');
          const zoom = Math.min(1, 600 / parsed.width, 300 / parsed.height);
          const renderer = new Resvg(bytes, { ...options, fitTo: { mode: 'zoom', value: zoom } });
          if (renderer.imagesToResolve().length) throw Error('unresolved resources');
          output = renderer.render().asPng();
        } else {
          const dimensions = rasterDimensions(bytes);
          if (!dimensions || dimensions.format !== format || !dimensions.width || !dimensions.height || dimensions.width * dimensions.height > 4000000) throw Error('raster dimensions');
          const { jsPDF } = require(${JSON.stringify(require.resolve('jspdf'))});
          const image = jsPDF.API['process' + format].call(new jsPDF(), new Uint8Array(bytes), 0, 'logo', 'FAST');
          output = Buffer.from(image.data, 'latin1');
        }
        if (!output || output.length > MAX_LOGO_BYTES) throw Error('output size');
        process.stdout.write(output);
      } catch { process.exitCode = 1; }
    });
  `;
}

async function rasterizeLogo(
  bytes: Buffer,
  format: string,
): Promise<ReceiptLogo | undefined> {
  return new Promise((resolveResult) => {
    const child = spawn(
      process.execPath,
      ['--max-old-space-size=64', '-e', rendererScript(), format],
      {
        env: {},
        stdio: ['pipe', 'pipe', 'ignore'],
        shell: false,
      },
    );
    const chunks: Buffer[] = [];
    let size = 0,
      settled = false;
    const finish = (logo?: ReceiptLogo) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      resolveResult(logo);
    };
    const timer = setTimeout(() => finish(), LOGO_TIMEOUT_MS);
    child.on('error', () => finish());
    child.stdin.on('error', () => finish());
    child.stdout.on('data', (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_LOGO_BYTES) finish();
      else chunks.push(chunk);
    });
    child.on('close', (code) => {
      if (!settled)
        finish(
          code === 0 ? detectLogo(Buffer.concat(chunks, size)) : undefined,
        );
    });
    child.stdin.end(bytes);
  });
}

async function readLocalLogo(
  name: string,
  root: string,
): Promise<Buffer | undefined> {
  const base = resolve(root);
  const directory = join(base, 'logos');
  const filename = join(directory, name);
  for (const path of [base, directory]) {
    const info = await files.lstat(path);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (await files.realpath(path)) !== path
    )
      return;
  }
  const before = await files.lstat(filename);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.size > MAX_LOGO_BYTES ||
    (await files.realpath(filename)) !== filename
  )
    return;
  const handle = await files.open(
    filename,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const info = await handle.stat();
    // Comparing inode/device closes the ancestor-symlink swap between checks/open.
    if (
      !info.isFile() ||
      info.dev !== before.dev ||
      info.ino !== before.ino ||
      info.size > MAX_LOGO_BYTES
    )
      return;
    const buffer = Buffer.alloc(MAX_LOGO_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        size,
        Math.min(65536, buffer.length - size),
        size,
      );
      if (!bytesRead) break;
      size += bytesRead;
    }
    return size <= MAX_LOGO_BYTES ? buffer.subarray(0, size) : undefined;
  } finally {
    await handle.close();
  }
}

/** Only generated local logos and the configured Cloudinary upload folder are read. */
export async function resolveReceiptLogo(
  value: string | null | undefined,
  cloudName?: string,
  uploadRoot = './uploads',
): Promise<ReceiptLogo | undefined> {
  if (!value || value.length > MAX_LOGO_BYTES * 1.4) return;
  const data = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
    value,
  );
  if (data) {
    const logo = detectLogo(Buffer.from(data[2], 'base64'));
    return logo?.format === (data[1] === 'png' ? 'PNG' : 'JPEG')
      ? logo
      : undefined;
  }

  try {
    const local =
      /^\/uploads\/logos\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpe?g|gif|webp|svg))$/i.exec(
        value,
      );
    if (local) {
      const bytes = await readLocalLogo(local[1], uploadRoot);
      if (!bytes) return;
      const logo = detectLogo(bytes);
      if (logo) return logo;
      if (local[2].toLowerCase() === 'svg')
        return await rasterizeLogo(bytes, 'SVG');
      const raster = rasterDimensions(bytes);
      if (
        raster &&
        raster.width > 0 &&
        raster.height > 0 &&
        raster.width * raster.height <= 4_000_000
      )
        return await rasterizeLogo(bytes, raster.format);
      return;
    }
    if (!cloudName || !/^[A-Za-z0-9_-]+$/.test(cloudName)) return;
    const url = new URL(value);
    const prefix = `/${cloudName}/image/upload/`;
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'res.cloudinary.com' ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !url.pathname.startsWith(prefix) ||
      /[%\\]|\/\.\.?\//.test(value)
    )
      return;

    const original =
      /^(?:v([0-9]{1,16})\/)?logos\/([A-Za-z0-9_-]+)\.[A-Za-z0-9]+$/.exec(
        url.pathname.slice(prefix.length),
      );
    if (!original) return;
    const transformation = cloudinary.utils.generate_transformation_string({
      crop: 'limit',
      fetch_format: 'png',
      width: 600,
      height: 300,
    });
    const version = original[1] ? `v${original[1]}/` : '';
    const deliveryUrl = `https://res.cloudinary.com${prefix}${transformation}/${version}logos/${original[2]}.png`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOGO_TIMEOUT_MS);
    try {
      const response = await fetch(deliveryUrl, {
        redirect: 'error',
        signal: controller.signal,
        headers: { Accept: 'image/png, image/jpeg' },
      });
      if (!response.ok || response.redirected || !response.body) {
        await response.body?.cancel();
        return;
      }
      const length = Number(response.headers.get('content-length'));
      if (length > MAX_LOGO_BYTES) {
        await response.body.cancel();
        return;
      }
      const reader = response.body.getReader();
      const chunks: Buffer[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value: chunk } = await reader.read();
          if (done) break;
          size += chunk.byteLength;
          if (size > MAX_LOGO_BYTES) return;
          chunks.push(Buffer.from(chunk));
        }
        return detectLogo(Buffer.concat(chunks, size));
      } finally {
        await reader.cancel();
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // An unavailable or malformed logo must never prevent downloading a receipt.
    return;
  }
}
