const loginSection = document.querySelector('#login-section');
const loginForm = document.querySelector('#login-form');
const loginStatus = document.querySelector('#login-status');
const dashboard = document.querySelector('#admin-dashboard');
const dashboardStatus = document.querySelector('#dashboard-status');
const tributeList = document.querySelector('#tribute-list');
const tributeCount = document.querySelector('#tribute-count');
const portraitCurrent = document.querySelector('#portrait-current');
const portraitThumbnail = document.querySelector('#portrait-thumbnail');
const portraitStatus = document.querySelector('#portrait-status');
const portraitFile = document.querySelector('#portrait-file');
const cropDialog = document.querySelector('#crop-dialog');
const cropImage = document.querySelector('#crop-image');
const cropStatus = document.querySelector('#crop-status');
const saveCropButton = document.querySelector('#save-crop');
let cropper;
let cropSource;

function showPortrait(url) {
  portraitThumbnail.src = `${url}?v=${Date.now()}`;
  portraitCurrent.hidden = false;
  portraitStatus.textContent = 'The photo appears as a circular portrait over the flowers.';
}

async function loadPortrait() {
  const response = await fetch('/api/config');
  const { portraitAvailable, portraitUrl } = await response.json();
  if (portraitAvailable) {
    showPortrait(portraitUrl || '/images/her-portrait.jpg');
  } else {
    portraitCurrent.hidden = true;
    portraitStatus.textContent = 'No portrait yet. Choose a photo to add one to the flower hero.';
  }
}

function renderTributes(tributes) {
  tributeCount.textContent = `${tributes.length} ${tributes.length === 1 ? 'tribute' : 'tributes'} received`;
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
    date.textContent = new Date(`${tribute.createdAt.replace(' ', 'T')}Z`).toLocaleDateString(undefined, {
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
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Tributes could not be loaded.');
  renderTributes(result.tributes);
  await loadPortrait();
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
    const result = await response.json();
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
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Tribute status could not be updated.');
    const refreshed = await fetch('/api/admin/tributes').then((value) => value.json());
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

portraitFile.addEventListener('change', () => {
  const file = portraitFile.files[0];
  portraitFile.value = '';
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    portraitStatus.textContent = 'Choose a JPEG, PNG, or WebP image.';
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    portraitStatus.textContent = 'This photo is over 20 MB. Choose a smaller image.';
    return;
  }

  cropSource = URL.createObjectURL(file);
  cropImage.onload = () => {
    cropper?.destroy();
    cropper = new Cropper(cropImage, {
      aspectRatio: 1,
      viewMode: 1,
      dragMode: 'move',
      autoCropArea: 0.88,
      background: false,
      guides: false,
      responsive: true,
      restore: false,
    });
    cropStatus.textContent = '';
    cropDialog.showModal();
  };
  cropImage.onerror = () => {
    portraitStatus.textContent = 'This photo could not be opened. Try another image.';
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
  const canvas = cropper?.getCroppedCanvas({
    width: 1200,
    height: 1200,
    fillColor: '#ffffff',
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'high',
  });
  if (!canvas) return;

  saveCropButton.disabled = true;
  cropStatus.textContent = 'Saving her photo...';
  canvas.toBlob(async (image) => {
    try {
      if (!image) throw new Error('The crop could not be prepared. Please try again.');
      const response = await fetch('/api/admin/portrait', {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg' },
        body: image,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The portrait could not be saved.');
      showPortrait(result.portraitUrl || '/images/her-portrait.jpg');
      portraitStatus.textContent = 'Her photo is now in the flower hero.';
      dashboardStatus.textContent = 'Memorial portrait updated.';
      dashboardStatus.classList.remove('is-error');
      cropDialog.close();
    } catch (error) {
      cropStatus.textContent = error.message || 'The portrait could not be saved.';
    } finally {
      saveCropButton.disabled = false;
    }
  }, 'image/jpeg', 0.9);
});