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
const cropDialog = document.querySelector('#crop-dialog');
const cropImage = document.querySelector('#crop-image');
const cropStatus = document.querySelector('#crop-status');
const saveCropButton = document.querySelector('#save-crop');

let cropper;
let cropSource;
let activeSlot = null;
let currentCollage = [];

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
  for (let slot = 1; slot <= 5; slot += 1) {
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
    ? filled + ' of 5 photos in the hero collage.'
    : 'No photos yet — add up to 5 for a beautiful collage on the memorial page.';
  collageStatus.classList.remove('is-error');
}

async function loadCollage() {
  const response = await fetch('/api/config');
  const data = await readApiResponse(response);
  renderCollageSlots(data.collage || (data.portraitUrl ? [{ slot: 1, url: data.portraitUrl }] : []));
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
  await loadCollage();
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

collageSlots.addEventListener('click', async (event) => {
  const btn = event.target.closest('[data-action]');
  if (!btn) return;
  const slot = Number(btn.dataset.slot);
  if (btn.dataset.action === 'upload') {
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
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    collageStatus.textContent = 'Choose a JPEG, PNG, or WebP image.';
    collageStatus.classList.add('is-error');
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    collageStatus.textContent = 'This photo is over 20 MB. Choose a smaller image.';
    collageStatus.classList.add('is-error');
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
    cropStatus.textContent = '';
    cropDialog.showModal();
  };
  cropImage.onerror = () => {
    collageStatus.textContent = 'This photo could not be opened. Try another image.';
    collageStatus.classList.add('is-error');
    URL.revokeObjectURL(cropSource);
  };
  cropImage.src = cropSource;
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
