const crypto = require('node:crypto');
const { neon } = require('@neondatabase/serverless');
const { put } = require('@vercel/blob');
const PDFDocument = require('pdfkit');
const { Document, HeadingLevel, Packer, Paragraph, TextRun } = require('docx');

const adminUsername = process.env.ADMIN_USERNAME;
const adminPassword = process.env.ADMIN_PASSWORD;
const memorialName = process.env.MEMORIAL_NAME || 'Mrs. Onyewuoyeoma Blessing Nwaneri';
const sessionDuration = 12 * 60 * 60 * 1000;
// Fixed salt derived from a stable secret so password verification works across serverless cold starts.
const passwordSalt = crypto
  .createHash('sha256')
  .update(`memorial-salt:${process.env.ADMIN_SESSION_SECRET || adminPassword || 'onyeawuoyeoma-memorial'}`)
  .digest()
  .subarray(0, 16);
const passwordHash = adminPassword ? crypto.scryptSync(adminPassword, passwordSalt, 64) : null;
const limits = new Map();
let sql;
let schemaReady;

function fail(message, statusCode = 500) {
  return Object.assign(new Error(message), { statusCode });
}

function respond(response, statusCode, data, headers = {}) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  response.end(JSON.stringify(data));
}

function getSql() {
  const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!connectionString) throw fail('Connect a Postgres database in Vercel and set POSTGRES_URL.', 503);
  if (!sql) sql = neon(connectionString);
  return sql;
}

async function ensureSchema() {
  if (!schemaReady) {
    const query = getSql();
    schemaReady = (async () => {
      await query(`CREATE TABLE IF NOT EXISTS tributes (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published')),
        public_consent BOOLEAN NOT NULL DEFAULT FALSE
      )`);
      await query("ALTER TABLE tributes ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'");
      await query('ALTER TABLE tributes ADD COLUMN IF NOT EXISTS public_consent BOOLEAN NOT NULL DEFAULT FALSE');
      await query(`CREATE TABLE IF NOT EXISTS memorial_assets (
        name TEXT PRIMARY KEY,
        url TEXT NOT NULL
      )`);
    })();
  }
  await schemaReady;
  return getSql();
}

async function readBody(request, limit = 12_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw fail('Request is too large.', 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(request) {
  try {
    return JSON.parse((await readBody(request)).toString('utf8'));
  } catch (error) {
    if (error.statusCode) throw error;
    throw fail('Please check your submission and try again.', 400);
  }
}

function isRateLimited(request, response, key, maximum, windowMs) {
  const now = Date.now();
  const identity = `${key}:${request.headers['x-forwarded-for'] || 'unknown'}`;
  const entry = limits.get(identity);
  if (!entry || entry.resetAt <= now) {
    limits.set(identity, { count: 1, resetAt: now + windowMs });
    return false;
  }
  entry.count += 1;
  if (entry.count <= maximum) return false;
  respond(response, 429, { error: 'Too many attempts. Please try again later.' }, {
    'Retry-After': String(Math.ceil((entry.resetAt - now) / 1000)),
  });
  return true;
}

function passwordMatches(value) {
  if (!passwordHash) return false;
  const candidate = crypto.scryptSync(String(value || ''), passwordSalt, 64);
  return crypto.timingSafeEqual(candidate, passwordHash);
}

function createSession() {
  const payload = Buffer.from(JSON.stringify({ username: adminUsername, expiresAt: Date.now() + sessionDuration }))
    .toString('base64url');
  const secret = process.env.ADMIN_SESSION_SECRET || adminPassword;
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function hasAdminSession(request) {
  const cookie = request.headers.cookie || '';
  const token = cookie.match(/(?:^|;\s*)memorial_session=([A-Za-z0-9_.-]+)/)?.[1];
  const [payload, signature] = token ? token.split('.') : [];
  const secret = process.env.ADMIN_SESSION_SECRET || adminPassword;
  if (!payload || !signature || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest();
  let actual;
  try {
    actual = Buffer.from(signature, 'base64url');
  } catch {
    return false;
  }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return false;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return session.username === adminUsername && session.expiresAt > Date.now();
  } catch {
    return false;
  }
}

function setDownloadHeaders(response, filename, contentType) {
  response.writeHead(200, {
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
}

async function sendWordDocument(response, tributes) {
  const content = [
    new Paragraph({ text: `In Loving Memory of ${memorialName}`, heading: HeadingLevel.TITLE }),
    new Paragraph({ text: 'Tributes from family and friends', heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ text: `${tributes.length} ${tributes.length === 1 ? 'tribute' : 'tributes'} · ${new Date().toLocaleDateString()}` }),
    new Paragraph({ text: '' }),
  ];
  for (const tribute of tributes) {
    content.push(
      new Paragraph({ text: tribute.name, heading: HeadingLevel.HEADING_2 }),
      new Paragraph({ children: [new TextRun(tribute.message)] }),
      new Paragraph({ text: new Date(tribute.createdAt).toLocaleDateString() }),
      new Paragraph({ text: '' }),
    );
  }
  const buffer = await Packer.toBuffer(new Document({ sections: [{ children: content }] }));
  setDownloadHeaders(response, 'tributes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  response.end(buffer);
}

async function sendPdfDocument(response, tributes) {
  const document = new PDFDocument({ margin: 64 });
  const chunks = [];
  const buffer = new Promise((resolve, reject) => {
    document.on('data', (chunk) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
  });
  document.font('Times-Bold').fontSize(25).fillColor('#3d5144')
    .text(`In Loving Memory of ${memorialName}`, { align: 'center' });
  document.moveDown(0.6).font('Times-Roman').fontSize(12).fillColor('#59645b')
    .text(`Tributes from family and friends  ·  ${tributes.length} ${tributes.length === 1 ? 'tribute' : 'tributes'}`, { align: 'center' });
  document.moveDown(2);
  for (const tribute of tributes) {
    if (document.y > 680) document.addPage();
    document.font('Times-Bold').fontSize(15).fillColor('#3d5144').text(tribute.name);
    document.moveDown(0.25).font('Times-Roman').fontSize(12).fillColor('#272c28').text(tribute.message, { lineGap: 4 });
    document.moveDown(0.3).fontSize(9).fillColor('#727970').text(new Date(tribute.createdAt).toLocaleDateString());
    document.moveDown(1.1);
  }
  document.end();
  setDownloadHeaders(response, 'tributes.pdf', 'application/pdf');
  response.end(await buffer);
}

function jsonTribute(row) {
  return {
    id: String(row.id),
    name: row.name,
    message: row.message,
    createdAt: row.createdAt,
    ...(row.status ? { status: row.status, publicConsent: row.publicConsent } : {}),
  };
}

async function handler(request, response) {
  const url = new URL(request.url, `https://${request.headers.host || 'localhost'}`);
  const path = url.pathname;

  if (request.method === 'GET' && path === '/api/config') {
    let portraitUrl = null;
    try {
      const query = await ensureSchema();
      const result = await query("SELECT url FROM memorial_assets WHERE name = 'portrait'");
      portraitUrl = result[0]?.url || null;
    } catch {
      // Keep the memorial readable if storage has not been connected yet.
    }
    return respond(response, 200, { memorialName, portraitAvailable: Boolean(portraitUrl), portraitUrl });
  }

  if (request.method === 'GET' && path === '/api/tributes') {
    const query = await ensureSchema();
    const result = await query(`SELECT id, name, message,
      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS "createdAt"
      FROM tributes WHERE status = 'published' ORDER BY created_at ASC, id ASC`);
    return respond(response, 200, { tributes: result.map(jsonTribute) });
  }

  if (request.method === 'POST' && path === '/api/tributes') {
    if (isRateLimited(request, response, 'tribute', 8, 15 * 60 * 1000)) return;
    const body = await readJson(request);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!name || name.length > 100 || !message || message.length > 5000 || body.consent !== true) {
      return respond(response, 400, { error: 'Add your name, a message, and confirm name attribution.' });
    }
    const query = await ensureSchema();
    await query('INSERT INTO tributes (name, message, public_consent) VALUES ($1, $2, $3)', [name, message, body.publicConsent === true]);
    return respond(response, 201, { message: 'Your tribute has been sent to the family for review.' });
  }

  if (request.method === 'POST' && path === '/api/admin/login') {
    if (isRateLimited(request, response, 'login', 8, 15 * 60 * 1000)) return;
    if (!adminUsername || !passwordHash) return respond(response, 503, { error: 'Admin sign-in has not been configured.' });
    const body = await readJson(request);
    const matches = passwordMatches(body.password);
    if (body.username !== adminUsername || !matches) {
      return respond(response, 401, { error: 'That username and password did not match.' });
    }
    const secure = process.env.NODE_ENV === 'production' || process.env.VERCEL ? '; Secure' : '';
    return respond(response, 200, { message: 'Signed in.' }, {
      'Set-Cookie': `memorial_session=${createSession()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionDuration / 1000}${secure}`,
    });
  }

  if (request.method === 'POST' && path === '/api/admin/logout') {
    return respond(response, 200, { message: 'Signed out.' }, {
      'Set-Cookie': 'memorial_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0; Secure',
    });
  }

  if (path.startsWith('/api/admin/')) {
    if (!hasAdminSession(request)) return respond(response, 401, { error: 'Please sign in to continue.' });
    if (request.method === 'POST' && path === '/api/admin/portrait') {
      if (!process.env.BLOB_READ_WRITE_TOKEN) throw fail('Connect Vercel Blob storage before uploading a portrait.', 503);
      if (request.headers['content-type'] !== 'image/jpeg') throw fail('Please upload the cropped photo as a JPEG.', 415);
      const image = await readBody(request, 3 * 1024 * 1024);
      if (image.length < 4 || image[0] !== 0xff || image[1] !== 0xd8 || image.at(-2) !== 0xff || image.at(-1) !== 0xd9) {
        throw fail('The uploaded crop is not a valid JPEG image.', 400);
      }
      const blob = await put('her-portrait.jpg', image, {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'image/jpeg',
      });
      const query = await ensureSchema();
      await query(`INSERT INTO memorial_assets (name, url) VALUES ('portrait', $1)
        ON CONFLICT (name) DO UPDATE SET url = EXCLUDED.url`, [blob.url]);
      return respond(response, 200, { message: 'Portrait updated.', portraitUrl: blob.url });
    }

    if (request.method === 'GET' && path === '/api/admin/tributes') {
      const query = await ensureSchema();
      const result = await query(`SELECT id, name, message, status, public_consent AS "publicConsent",
        to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS "createdAt"
        FROM tributes ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC, id DESC`);
      return respond(response, 200, { tributes: result.map(jsonTribute) });
    }

    if (request.method === 'PATCH' && path === '/api/admin/tribute-status') {
      const body = await readJson(request);
      if (body.status !== 'pending' && body.status !== 'published') {
        return respond(response, 400, { error: 'Choose whether to publish this tribute.' });
      }
      if (!/^\d+$/.test(String(body.id))) return respond(response, 400, { error: 'Choose a valid tribute.' });
      const query = await ensureSchema();
      const result = await query('SELECT public_consent FROM tributes WHERE id = $1', [body.id]);
      if (!result.length) return respond(response, 404, { error: 'Tribute not found.' });
      if (body.status === 'published' && result[0].public_consent !== true) {
        return respond(response, 403, { error: 'This writer did not give permission for public display.' });
      }
      await query('UPDATE tributes SET status = $1 WHERE id = $2', [body.status, body.id]);
      return respond(response, 200, { message: 'Tribute status updated.' });
    }

    if (request.method === 'GET' && (path === '/api/admin/export/docx' || path === '/api/admin/export/pdf')) {
      const query = await ensureSchema();
      const result = await query(`SELECT name, message,
        to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS "createdAt"
        FROM tributes ORDER BY created_at ASC, id ASC`);
      return path.endsWith('/docx')
        ? await sendWordDocument(response, result)
        : await sendPdfDocument(response, result);
    }
  }

  return respond(response, 404, { error: 'Not found.' });
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
