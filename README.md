# Onyeawuoyeoma Memorial

A small, shareable memorial page where family and friends can send tributes for family review. The family can approve public messages and download a Word or PDF collection.

## Run locally

Requires Node.js 22.13 or newer. Copy `.env.example` to `.env`, set a unique `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and the name to display, then run:

```sh
npm install
npm start
```

Open `http://localhost:3000`. The family page is at `/admin`. Tributes are stored in `data/tributes.sqlite`; the database directory should be kept on persistent storage when hosting. Do not commit `.env` or share the admin password.

## Share with family and friends

For Vercel, connect a Postgres database and a Blob store to the project, then set `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `MEMORIAL_NAME` in project environment variables. Make sure `POSTGRES_URL` and `BLOB_READ_WRITE_TOKEN` are available to the deployment. Vercel serves the pages statically and routes `/api/*` to serverless functions; the local SQLite server is only used by `npm start`. Share the deployed root URL for the memorial page and use HTTPS. Admin sessions expire after 12 hours.

New tributes are private by default. Writers can separately consent to online display and printed name attribution. The family reviews each submission at `/admin`; only consented, approved messages appear on the memorial page. The family can download all submissions, including writer names, as `.docx` and `.pdf` files.

## Family admin

At `/admin`, sign in to manage the hero collage (up to 4 photos), the photo gallery (up to 100 photos), review tributes, publish or unpublish messages, and download the full collection. Each tribute is private by default. Writers must separately opt in to online display, and the family must approve it before it appears below the hero. The print-attribution checkbox is separate.

The memorial homepage shows a QR code under the hero that opens `/gallery`, where visitors can browse all gallery photographs in a clean grid with a full-screen lightbox.

Hero collage photos use a 4:5 crop for a balanced layout. Gallery photos use a square crop and are stored separately so you can keep a large collection without affecting the homepage collage.

Photos are stored in Vercel Blob, and tribute records are stored in Postgres. On local development, SQLite is used for tributes; collage/gallery uploads require Blob when deployed.
