const loginSection = document.querySelector('#login-section');
const loginForm = document.querySelector('#login-form');
const loginStatus = document.querySelector('#login-status');
const dashboard = document.querySelector('#admin-dashboard');
const dashboardStatus = document.querySelector('#dashboard-status');
const tributeList = document.querySelector('#tribute-list');
const tributeCount = document.querySelector('#tribute-count');
const collageSlots = document.querySelector('#collage-slots');
const collageStatus = document.querySelector('#collage-status');
const collageFile = document.querySelector('#collage-file');
const galleryAdminGrid = document.querySelector('#gallery-admin-grid');
const galleryStatus = document.querySelector('#gallery-status');
const galleryFile = document.querySelector('#gallery-file');
const galleryAddButton = document.querySelector('#gallery-add-button');
const cropDialog = document.querySelector('#crop-dialog');
const cropImage = document.querySelector('#crop-image');
const cropStatus = document.querySelector('#crop-status');
const saveCropButton = document.querySelector('#save-crop');
const cropTitle = document.querySelector('#crop-title');

const COLLAGE_MAX = 4;
const GALLERY_MAX = 100;

let cropper;
let cropSource;
let activeSlot = null;
let cropMode = 'collage';
let currentCollage = [];
let currentGallery = [];

async function readApiResponse(response) {
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error(`Admin service unavailable (HTTP ${response.status}). Please try again later.`);
  }
  return response.json();
}

function renderCollageSlots(collage) {
  currentCollage = Array.isArray(collage) ? collage : [];
  const bySlot = {};
  for (const item of currentCollage) bySlot[item.slot] = item.url;
  collageSlots.replaceChildren();
  for (let slot = 1; slot <= COLLAGE_MAX; slot += 1) {
    const el = document.createElement('div');
    el.className = 'collage-slot' + (bySlot[slot] ? ' has-photo' : '');
    el.dataset.slot = String(slot);
    const label = document.createElement('span');
    label.className = 'slot-label';
    label.textContent = 'Photo ' + slot;
    el.append(label);
    if (bySlot[slot]) {
      const img = document.createElement('img');
      img.src = bySlot[slot] + '?v=' + Date.now();
      img.alt = 'Collage photo ' + slot;
      el.append(img);
    }
    const actions = document.createElement('div');
    actions.className = 'slot-actions';
    const replaceBtn = document.createElement('button');
    replaceBtn.type = 'button';
    replaceBtn.className = 'slot-btn';
    replaceBtn.dataset.action = 'upload';
    replaceBtn.dataset.slot = String(slot);
    replaceBtn.textContent = bySlot[slot] ? 'Replace' : 'Add';
    actions.append(replaceBtn);
    if (bySlot[slot]) {
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'slot-btn slot-btn-danger';
      removeBtn.dataset.action = 'remove';
      removeBtn.dataset.slot = String(slot);
      removeBtn.textContent = 'Remove';
      actions.append(removeBtn);
    }
    el.append(actions);
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'slot-add';
    addBtn.dataset.action = 'upload';
    addBtn.dataset.slot = String(slot);
    addBtn.textContent = 'Add photo';
    el.append(addBtn);
    collageSlots.append(el);
  }
  const filled = currentCollage.length;
  collageStatus.textContent = filled
    ? filled + ' of ' + COLLAGE_MAX + ' photos in the hero collage.'
    : 'No photos yet — add up to ' + COLLAGE_MAX + ' for a balanced collage on the memorial page.';
  collageStatus.classList.remove('is-error');
}

function renderGalleryAdmin(gallery) {
  currentGallery = Array.isArray(gallery) ? gallery : [];
  galleryAdminGrid.replaceChildren();
  if (!currentGallery.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No gallery photos yet. Use “Add photos” to begin the collection visitors see when they scan the QR code.';
    galleryAdminGrid.append(empty);
  } else {
    for (const item of currentGallery) {
      const el = document.createElement('div');
      el.className = 'collage-slot has-photo gallery-admin-item';
      el.dataset.slot = String(item.slot);
      const img = document.createElement('img');
      img.src = item.url + '?v=' + Date.now();
      img.alt = 'Gallery photo ' + item.slot;
      el.append(img);
      const actions = document.createElement('div');
      actions.className = 'slot-actions';
      actions.style.opacity = '1';
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'slot-btn slot-btn-danger';
      removeBtn.dataset.galleryAction = 'remove';
      removeBtn.dataset.slot = String(item.slot);
      removeBtn.textContent = 'Remove';
      actions.append(removeBtn);
      el.append(actions);
      galleryAdminGrid.append(el);
    }
  }
  const filled = currentGallery.length;
  galleryStatus.textContent = filled
    ? filled + ' of ' + GALLERY_MAX + ' gallery photographs.'
    : 'Gallery is empty — add photos for the QR code page.';
  galleryStatus.classList.remove('is-error');
  if (galleryAddButton) galleryAddButton.disabled = filled >= GALLERY_MAX;
}

async function loadAssets() {
  const response = await fetch('/api/config');
  const data = await readApiResponse(response);
  renderCollageSlots(data.collage || (data.portraitUrl ? [{ slot: 1, url: data.portraitUrl }] : []));
  renderGalleryAdmin(data.gallery || []);
}

function renderTributes(tributes) {
  tributeCount.textContent = tributes.length + ' ' + (tributes.length === 1 ? 'tribute' : 'tributes') + ' received';
  tributeList.replaceChildren();
  if (!tributes.length) {
    const emptyState = document.createElement('p');
    emptyState.className = 'empty-state';
    emptyState.textContent = 'No tributes yet. When someone shares their words, they will be gathered here.';
    tributeList.append(emptyState);
    return;
  }
  for (const tribute of tributes) {
    const article = document.createElement('article');
    article.className = 'tribute-entry';
    article.dataset.status = tribute.status;
    const heading = document.createElement('h3');
    heading.textContent = tribute.name;
    const date = document.createElement('time');
    date.dateTime = tribute.createdAt;
    date.textContent = new Date(tribute.createdAt.replace(' ', 'T') + 'Z').toLocaleDateString(undefined, {
      year: 'numeric', month: 'long', day: 'numeric',
    });
    const message = document.createElement('p');
    message.textContent = tribute.message;
    const status = document.createElement('span');
    status.className = 'tribute-status';
    status.textContent = tribute.status === 'published' ? 'Published on memorial' : 'Pending review';
    article.append(heading, date, status, message);
    if (tribute.publicConsent) {
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'text-button tribute-publish-button';
      action.dataset.tributeId = tribute.id;
      action.dataset.nextStatus = tribute.status === 'published' ? 'pending' : 'published';
      action.textContent = tribute.status === 'published' ? 'Remove from memorial' : 'Approve and publish';
      article.append(action);
    } else {
      const note = document.createElement('p');
      note.className = 'consent-reminder';
      note.textContent = 'Private only. The writer did not opt in to online display.';
      article.append(note);
    }
    tributeList.append(article);
  }
}

async function showDashboard() {
  const response = await fetch('/api/admin/tributes');
  if (response.status === 401) return false;
  const result = await readApiResponse(response);
  if (!response.ok) throw new Error(result.error || 'Tributes could not be loaded.');
  renderTributes(result.tributes);
  await loadAssets();
  loginSection.hidden = true;
  dashboard.hidden = false;
  return true;
}

showDashboard().catch(() => {
  loginStatus.textContent = 'Tributes could not be loaded. Please sign in again.';
  loginStatus.classList.add('is-error');
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitButton = loginForm.querySelector('button[type="submit"]');
  const formData = new FormData(loginForm);
  submitButton.disabled = true;
  loginStatus.textContent = 'Signing in...';
  loginStatus.classList.remove('is-error');
  try {
    const response = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: formData.get('username'),
        password: formData.get('password'),
      }),
    });
    const result = await readApiResponse(response);
    if (!response.ok) throw new Error(result.error || 'Sign in failed.');
    loginForm.reset();
    await showDashboard();
  } catch (error) {
    loginStatus.textContent = error.message || 'Sign in failed. Please try again.';
    loginStatus.classList.add('is-error');
  } finally {
    submitButton.disabled = false;
  }
});

document.querySelector('#logout-button').addEventListener('click', async () => {
  await fetch('/api/admin/logout', { method: 'POST' });
  dashboard.hidden = true;
  loginSection.hidden = false;
  loginStatus.textContent = 'You have signed out.';
});

tributeList.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-tribute-id]');
  if (!button) return;
  button.disabled = true;
  dashboardStatus.textContent = 'Updating tribute...';
  dashboardStatus.classList.remove('is-error');
  try {
    const response = await fetch('/api/admin/tribute-status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: button.dataset.tributeId, status: button.dataset.nextStatus }),
    });
    const result = await readApiResponse(response);
    if (!response.ok) throw new Error(result.error || 'Tribute status could not be updated.');
    const refreshed = await fetch('/api/admin/tributes').then(readApiResponse);
    renderTributes(refreshed.tributes);
    dashboardStatus.textContent = button.dataset.nextStatus === 'published'
      ? 'Tribute approved and now visible on the memorial page.'
      : 'Tribute removed from the public page.';
  } catch (error) {
    dashboardStatus.textContent = error.message || 'Tribute status could not be updated.';
    dashboardStatus.classList.add('is-error');
    button.disabled = false;
  }
});

function openCropperForFile(file, statusEl) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    statusEl.textContent = 'Choose a JPEG, PNG, or WebP image.';
    statusEl.classList.add('is-error');
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    statusEl.textContent = 'This photo is over 20 MB. Choose a smaller image.';
    statusEl.classList.add('is-error');
    return;
  }
  cropSource = URL.createObjectURL(file);
  cropImage.onload = () => {
    cropper?.destroy();
    cropper = new Cropper(cropImage, {
      aspectRatio: 4 / 5,
      viewMode: 1,
      dragMode: 'move',
      autoCropArea: 0.9,
      background: false,
      guides: true,
      responsive: true,
      restore: false,
    });
    if (cropTitle) cropTitle.textContent = 'Frame for the collage';
    cropStatus.textContent = '';
    cropDialog.showModal();
  };
  cropImage.onerror = () => {
    statusEl.textContent = 'This photo could not be opened. Try another image.';
    statusEl.classList.add('is-error');
    URL.revokeObjectURL(cropSource);
  };
  cropImage.src = cropSource;
}

/** Convert any supported image to a JPEG Blob (full image, no crop). */
function fileToJpegBlob(file, maxSide = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      reject(new Error('Choose a JPEG, PNG, or WebP image.'));
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      reject(new Error('This photo is over 20 MB. Choose a smaller image.'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxSide || height > maxSide) {
        const scale = maxSide / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Could not prepare the photo.'))),
        'image/jpeg',
        quality,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('This photo could not be opened. Try another image.'));
    };
    img.src = url;
  });
}

async function uploadGalleryFiles(files) {
  const list = Array.from(files || []).filter(Boolean);
  if (!list.length) return;

  const remaining = GALLERY_MAX - currentGallery.length;
  if (remaining <= 0) {
    galleryStatus.textContent = 'Gallery is full (maximum ' + GALLERY_MAX + ' photos).';
    galleryStatus.classList.add('is-error');
    return;
  }

  const toUpload = list.slice(0, remaining);
  if (list.length > remaining) {
    galleryStatus.textContent = 'Only ' + remaining + ' more photo(s) can be added. Uploading the first ' + remaining + '…';
  } else {
    galleryStatus.textContent = 'Uploading ' + toUpload.length + ' photo' + (toUpload.length === 1 ? '' : 's') + '…';
  }
  galleryStatus.classList.remove('is-error');
  if (galleryAddButton) galleryAddButton.disabled = true;

  let ok = 0;
  let lastGallery = currentGallery;
  const errors = [];

  for (const file of toUpload) {
    try {
      const image = await fileToJpegBlob(file);
      const response = await fetch('/api/admin/gallery', {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg' },
        body: image,
      });
      const result = await readApiResponse(response);
      if (!response.ok) throw new Error(result.error || 'The photo could not be saved.');
      lastGallery = result.gallery;
      ok += 1;
      galleryStatus.textContent = 'Uploaded ' + ok + ' of ' + toUpload.length + '…';
    } catch (err) {
      errors.push((file.name || 'photo') + ': ' + (err.message || 'failed'));
    }
  }

  // Always re-fetch from server so the grid matches the database
  try {
    await loadAssets();
  } catch {
    renderGalleryAdmin(lastGallery);
  }

  if (ok > 0) {
    dashboardStatus.textContent =
      ok === 1 ? '1 photo added to the gallery.' : ok + ' photos added to the gallery.';
    dashboardStatus.classList.remove('is-error');
  }
  if (errors.length) {
    galleryStatus.textContent =
      (ok ? ok + ' uploaded. ' : '') + 'Some photos failed: ' + errors.slice(0, 3).join('; ');
    galleryStatus.classList.add('is-error');
  } else if (ok === toUpload.length) {
    galleryStatus.textContent =
      currentGallery.length + ' of ' + GALLERY_MAX + ' gallery photographs.';
    galleryStatus.classList.remove('is-error');
  }
  if (galleryAddButton) galleryAddButton.disabled = currentGallery.length >= GALLERY_MAX;
}

collageSlots.addEventListener('click', async (event) => {
  const btn = event.target.closest('[data-action]');
  if (!btn) return;
  const slot = Number(btn.dataset.slot);
  if (btn.dataset.action === 'upload') {
    cropMode = 'collage';
    activeSlot = slot;
    collageFile.click();
    return;
  }
  if (btn.dataset.action === 'remove') {
    btn.disabled = true;
    collageStatus.textContent = 'Removing photo...';
    try {
      const response = await fetch('/api/admin/collage?slot=' + slot, { method: 'DELETE' });
      const result = await readApiResponse(response);
      if (!response.ok) throw new Error(result.error || 'Could not remove photo.');
      renderCollageSlots(result.collage);
      dashboardStatus.textContent = 'Photo ' + slot + ' removed from the collage.';
      dashboardStatus.classList.remove('is-error');
    } catch (error) {
      collageStatus.textContent = error.message || 'Could not remove photo.';
      collageStatus.classList.add('is-error');
      btn.disabled = false;
    }
  }
});

collageFile.addEventListener('change', () => {
  const file = collageFile.files[0];
  collageFile.value = '';
  if (!file || !activeSlot) return;
  cropMode = 'collage';
  openCropperForFile(file, collageStatus);
});

galleryAddButton?.addEventListener('click', () => {
  if (currentGallery.length >= GALLERY_MAX) {
    galleryStatus.textContent = 'Gallery is full (maximum ' + GALLERY_MAX + ' photos).';
    galleryStatus.classList.add('is-error');
    return;
  }
  galleryFile.click();
});

galleryFile?.addEventListener('change', () => {
  const files = galleryFile.files;
  galleryFile.value = '';
  if (!files || !files.length) return;
  uploadGalleryFiles(files);
});

galleryAdminGrid?.addEventListener('click', async (event) => {
  const btn = event.target.closest('[data-gallery-action="remove"]');
  if (!btn) return;
  const slot = Number(btn.dataset.slot);
  btn.disabled = true;
  galleryStatus.textContent = 'Removing photo...';
  try {
    const response = await fetch('/api/admin/gallery?slot=' + slot, { method: 'DELETE' });
    const result = await readApiResponse(response);
    if (!response.ok) throw new Error(result.error || 'Could not remove photo.');
    renderGalleryAdmin(result.gallery);
    dashboardStatus.textContent = 'Gallery photo removed.';
    dashboardStatus.classList.remove('is-error');
  } catch (error) {
    galleryStatus.textContent = error.message || 'Could not remove photo.';
    galleryStatus.classList.add('is-error');
    btn.disabled = false;
  }
});

document.querySelector('#zoom-out').addEventListener('click', () => cropper?.zoom(-0.1));
document.querySelector('#zoom-in').addEventListener('click', () => cropper?.zoom(0.1));
document.querySelector('#rotate-left').addEventListener('click', () => cropper?.rotate(-90));
document.querySelector('#cancel-crop').addEventListener('click', () => cropDialog.close());
document.querySelector('#discard-crop').addEventListener('click', () => cropDialog.close());

cropDialog.addEventListener('close', () => {
  cropper?.destroy();
  cropper = null;
  if (cropSource) URL.revokeObjectURL(cropSource);
  cropSource = null;
});

saveCropButton.addEventListener('click', () => {
  if (!activeSlot) return;
  const canvas = cropper?.getCroppedCanvas({
    width: 1200,
    height: 1500,
    fillColor: '#ffffff',
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'high',
  });
  if (!canvas) return;
  saveCropButton.disabled = true;
  cropStatus.textContent = 'Saving photo...';
  canvas.toBlob(async (image) => {
    try {
      if (!image) throw new Error('The crop could not be prepared. Please try again.');
      const response = await fetch('/api/admin/collage?slot=' + activeSlot, {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg' },
        body: image,
      });
      const result = await readApiResponse(response);
      if (!response.ok) throw new Error(result.error || 'The photo could not be saved.');
      renderCollageSlots(result.collage);
      dashboardStatus.textContent = 'Photo ' + activeSlot + ' saved to the collage.';
      dashboardStatus.classList.remove('is-error');
      cropDialog.close();
    } catch (error) {
      cropStatus.textContent = error.message || 'The photo could not be saved.';
    } finally {
      saveCropButton.disabled = false;
    }
  }, 'image/jpeg', 0.9);
});
