const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const PDFDocument = require('pdfkit');
const { Document, HeadingLevel, Packer, Paragraph, TextRun } = require('docx');

const port = Number(process.env.PORT || 3000);
const adminUsername = process.env.ADMIN_USERNAME;
const adminPassword = process.env.ADMIN_PASSWORD;
const memorialName = process.env.MEMORIAL_NAME || 'Mrs. Onyewuoyeoma Blessing Nwaneri';
const sessionDuration = 12 * 60 * 60 * 1000;
const isProduction = process.env.NODE_ENV === 'production';
const databasePath = path.resolve(process.env.DATABASE_PATH || path.join(__dirname, 'data', 'tributes.sqlite'));
const portraitPath = path.join(__dirname, 'public', 'images', 'her-portrait.jpg');
fs.mkdirSync(path.dirname(databasePath), { recursive: true });
fs.mkdirSync(path.dirname(portraitPath), { recursive: true });

const database = new DatabaseSync(databasePath);
database.exec(`
  CREATE TABLE IF NOT EXISTS tributes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'published')),
    public_consent INTEGER NOT NULL DEFAULT 0 CHECK(public_consent IN (0, 1))
  )
`);
const tributeColumns = database.prepare('PRAGMA table_info(tributes)').all().map((column) => column.name);
if (!tributeColumns.includes('status')) {
  database.exec("ALTER TABLE tributes ADD COLUMN status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'published'))");
}
if (!tributeColumns.includes('public_consent')) {
  database.exec('ALTER TABLE tributes ADD COLUMN public_consent INTEGER NOT NULL DEFAULT 0 CHECK(public_consent IN (0, 1))');
}

const sessions = new Map();
const limits = new Map();
const staticFiles = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/admin': ['admin.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/guest.js': ['guest.js', 'text/javascript; charset=utf-8'],
  '/admin.js': ['admin.js', 'text/javascript; charset=utf-8'],
  '/vendor/cropper.css': ['../node_modules/cropperjs/dist/cropper.css', 'text/css; charset=utf-8'],
  '/vendor/cropper.js': ['../node_modules/cropperjs/dist/cropper.js', 'text/javascript; charset=utf-8'],
  '/images/her-portrait.jpg': ['images/her-portrait.jpg', 'image/jpeg'],
};

function sendJson(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

function getSession(request) {
  const cookies = request.headers.cookie || '';
  const token = cookies.match(/(?:^|;\s*)memorial_session=([a-f0-9]+)/)?.[1];
  const session = token && sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    if (token) sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + sessionDuration;
  return token;
}

function isAdmin(request, response) {
  if (getSession(request)) return true;
  sendJson(response, 401, { error: 'Please sign in to continue.' });
  return false;
}

function isRateLimited(request, response, key, maximum, windowMs) {
  const now = Date.now();
  const identity = `${key}:${request.socket.remoteAddress || 'unknown'}`;
  const entry = limits.get(identity);
  if (!entry || entry.resetAt <= now) {
    limits.set(identity, { count: 1, resetAt: now + windowMs });
    return false;
  }
  entry.count += 1;
  if (entry.count <= maximum) return false;
  sendJson(response, 429, { error: 'Too many attempts. Please try again later.' }, {
    'Retry-After': String(Math.ceil((entry.resetAt - now) / 1000)),
  });
  return true;
}

async function readJson(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 12_000) throw Object.assign(new Error('Request is too large.'), { statusCode: 413 });
  }
  try {
    return JSON.parse(body);
  } catch {
    throw Object.assign(new Error('Please check your submission and try again.'), { statusCode: 400 });
  }
}

async function readCroppedImage(request) {
  if (request.headers['content-type'] !== 'image/jpeg') {
    throw Object.assign(new Error('Please upload the cropped photo as a JPEG.'), { statusCode: 415 });
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 3 * 1024 * 1024) {
      throw Object.assign(new Error('The cropped photo is too large. Please try a smaller crop.'), { statusCode: 413 });
    }
    chunks.push(chunk);
  }
  const image = Buffer.concat(chunks);
  if (image.length < 4 || image[0] !== 0xff || image[1] !== 0xd8 || image.at(-2) !== 0xff || image.at(-1) !== 0xd9) {
    throw Object.assign(new Error('The uploaded crop is not a valid JPEG image.'), { statusCode: 400 });
  }
  return image;
}

function constantTimePasswordMatch(value) {
  const candidate = crypto.scryptSync(String(value || ''), passwordSalt, 64);
  return crypto.timingSafeEqual(candidate, passwordHash);
}

const passwordSalt = crypto.randomBytes(16);
const passwordHash = adminPassword ? crypto.scryptSync(adminPassword, passwordSalt, 64) : null;

function getTributes() {
  return database.prepare('SELECT id, name, message, created_at AS createdAt, status, public_consent AS publicConsent FROM tributes ORDER BY CASE status WHEN \'pending\' THEN 0 ELSE 1 END, id DESC').all();
}

function getPublishedTributes() {
  return database.prepare("SELECT id, name, message, created_at AS createdAt FROM tributes WHERE status = 'published' ORDER BY id ASC").all();
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
      new Paragraph({ text: new Date(`${tribute.createdAt.replace(' ', 'T')}Z`).toLocaleDateString() }),
      new Paragraph({ text: '' }),
    );
  }

  const document = new Document({ sections: [{ children: content }] });
  const buffer = await Packer.toBuffer(document);
  setDownloadHeaders(response, 'tributes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  response.end(buffer);
}

function sendPdfDocument(response, tributes) {
  setDownloadHeaders(response, 'tributes.pdf', 'application/pdf');
  const document = new PDFDocument({ margin: 64, bufferPages: true });
  document.pipe(response);
  document.font('Times-Bold').fontSize(25).fillColor('#3d5144').text(`In Loving Memory of ${memorialName}`, { align: 'center' });
  document.moveDown(0.6).font('Times-Roman').fontSize(12).fillColor('#59645b')
    .text(`Tributes from family and friends  ·  ${tributes.length} ${tributes.length === 1 ? 'tribute' : 'tributes'}`, { align: 'center' });
  document.moveDown(2);

  for (const tribute of tributes) {
    if (document.y > 680) document.addPage();
    document.font('Times-Bold').fontSize(15).fillColor('#3d5144').text(tribute.name);
    document.moveDown(0.25).font('Times-Roman').fontSize(12).fillColor('#272c28').text(tribute.message, { lineGap: 4 });
    document.moveDown(0.3).fontSize(9).fillColor('#727970')
      .text(new Date(`${tribute.createdAt.replace(' ', 'T')}Z`).toLocaleDateString());
    document.moveDown(1.1);
  }
  document.end();
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  try {
    if (request.method === 'GET' && url.pathname === '/api/config') {
      return sendJson(response, 200, {
        memorialName,
        portraitAvailable: fs.existsSync(path.join(__dirname, 'public', 'images', 'her-portrait.jpg')),
        portraitUrl: fs.existsSync(path.join(__dirname, 'public', 'images', 'her-portrait.jpg'))
          ? '/images/her-portrait.jpg'
          : null,
      });
    }

    if (request.method === 'GET' && url.pathname === '/api/tributes') {
      return sendJson(response, 200, { tributes: getPublishedTributes() });
    }

    if (request.method === 'POST' && url.pathname === '/api/tributes') {
      if (isRateLimited(request, response, 'tribute', 8, 15 * 60 * 1000)) return;
      const body = await readJson(request);
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const message = typeof body.message === 'string' ? body.message.trim() : '';
      if (!name || name.length > 100 || !message || message.length > 5000 || body.consent !== true) {
        return sendJson(response, 400, { error: 'Add your name, a message, and confirm name attribution.' });
      }
      database.prepare('INSERT INTO tributes (name, message, public_consent) VALUES (?, ?, ?)')
        .run(name, message, body.publicConsent === true ? 1 : 0);
      return sendJson(response, 201, { message: 'Your tribute has been sent to the family for review.' });
    }

    if (request.method === 'POST' && url.pathname === '/api/admin/login') {
      if (isRateLimited(request, response, 'login', 8, 15 * 60 * 1000)) return;
      if (!adminUsername || !passwordHash) return sendJson(response, 503, { error: 'Admin sign-in has not been configured.' });
      const body = await readJson(request);
      const passwordMatches = constantTimePasswordMatch(body.password);
      if (body.username !== adminUsername || !passwordMatches) {
        return sendJson(response, 401, { error: 'That username and password did not match.' });
      }
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, { expiresAt: Date.now() + sessionDuration });
      return sendJson(response, 200, { message: 'Signed in.' }, {
        'Set-Cookie': `memorial_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionDuration / 1000}${isProduction ? '; Secure' : ''}`,
      });
    }

    if (request.method === 'POST' && url.pathname === '/api/admin/logout') {
      const token = getSession(request);
      if (token) sessions.delete(token);
      return sendJson(response, 200, { message: 'Signed out.' }, {
        'Set-Cookie': 'memorial_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0',
      });
    }

    if (url.pathname.startsWith('/api/admin/')) {
      if (!isAdmin(request, response)) return;
      if (request.method === 'POST' && url.pathname === '/api/admin/portrait') {
        const image = await readCroppedImage(request);
        const temporaryPath = `${portraitPath}.${crypto.randomBytes(8).toString('hex')}.tmp`;
        fs.writeFileSync(temporaryPath, image, { mode: 0o644, flag: 'wx' });
        fs.renameSync(temporaryPath, portraitPath);
        return sendJson(response, 200, { message: 'Portrait updated.' });
      }
      if (request.method === 'GET' && url.pathname === '/api/admin/tributes') {
        return sendJson(response, 200, { tributes: getTributes() });
      }
      const tributeStatus = url.pathname.match(/^\/api\/admin\/tributes\/(\d+)$/);
      if (request.method === 'PATCH' && tributeStatus) {
        const body = await readJson(request);
        if (body.status !== 'pending' && body.status !== 'published') {
          return sendJson(response, 400, { error: 'Choose whether to publish this tribute.' });
        }
        const tribute = database.prepare('SELECT public_consent AS publicConsent FROM tributes WHERE id = ?')
          .get(Number(tributeStatus[1]));
        if (!tribute) return sendJson(response, 404, { error: 'Tribute not found.' });
        if (body.status === 'published' && tribute.publicConsent !== 1) {
          return sendJson(response, 403, { error: 'This writer did not give permission for public display.' });
        }
        database.prepare('UPDATE tributes SET status = ? WHERE id = ?').run(body.status, Number(tributeStatus[1]));
        return sendJson(response, 200, { message: 'Tribute status updated.' });
      }
      if (request.method === 'GET' && url.pathname === '/api/admin/export/docx') {
        return await sendWordDocument(response, getTributes());
      }
      if (request.method === 'GET' && url.pathname === '/api/admin/export/pdf') {
        return sendPdfDocument(response, getTributes());
      }
    }

    if (request.method === 'GET' && staticFiles[url.pathname]) {
      const [filename, contentType] = staticFiles[url.pathname];
      const filePath = path.resolve(__dirname, 'public', filename);
      if (!fs.existsSync(filePath)) return sendJson(response, 404, { error: 'Image not added yet.' });
      response.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; script-src 'self'; img-src 'self' https://images.unsplash.com data:; font-src 'self' https://fonts.gstatic.com; form-action 'self'; frame-ancestors 'none'; base-uri 'self'",
        'Referrer-Policy': 'strict-origin-when-cross-origin',
      });
      fs.createReadStream(filePath).pipe(response);
      return;
    }

    sendJson(response, 404, { error: 'Not found.' });
  } catch (error) {
    if (response.headersSent) return response.destroy();
    sendJson(response, error.statusCode || 500, {
      error: error.statusCode ? error.message : 'Something went wrong. Please try again.',
    });
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Memorial tribute book is running on port ${port}.`);
  if (!adminPassword) console.warn('Set ADMIN_PASSWORD in .env before using the admin page.');
});

for (const map of [sessions, limits]) {
  setInterval(() => {
    const now = Date.now();
    for (const [key, value] of map) {
      const expiry = value.expiresAt || value.resetAt;
      if (expiry <= now) map.delete(key);
    }
  }, 60 * 60 * 1000).unref();
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    database.close();
    server.close(() => process.exit(0));
  });
}