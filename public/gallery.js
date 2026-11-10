const galleryGrid = document.querySelector('#gallery-grid');
const galleryCount = document.querySelector('#gallery-count');
const memorialNameEl = document.querySelector('#gallery-memorial-name');
const lightbox = document.querySelector('#lightbox');
const lightboxImage = document.querySelector('#lightbox-image');
const lightboxCaption = document.querySelector('#lightbox-caption');
const lightboxClose = document.querySelector('#lightbox-close');
const lightboxPrev = document.querySelector('#lightbox-prev');
const lightboxNext = document.querySelector('#lightbox-next');

let photos = [];
let currentIndex = 0;

async function readApiResponse(response) {
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error(`Gallery unavailable (HTTP ${response.status}).`);
  }
  return response.json();
}

function openLightbox(index) {
  if (!photos.length) return;
  currentIndex = ((index % photos.length) + photos.length) % photos.length;
  const photo = photos[currentIndex];
  lightboxImage.src = photo.url;
  lightboxImage.alt = `Photograph ${currentIndex + 1} of ${photos.length}`;
  lightboxCaption.textContent = `${currentIndex + 1} / ${photos.length}`;
  if (!lightbox.open) lightbox.showModal();
}

function closeLightbox() {
  lightbox.close();
  lightboxImage.removeAttribute('src');
}

function renderGallery(items) {
  photos = Array.isArray(items) ? items.filter((item) => item?.url) : [];
  galleryGrid.replaceChildren();

  if (!photos.length) {
    const empty = document.createElement('p');
    empty.className = 'wall-empty';
    empty.textContent = 'Photos will appear here once the family adds them.';
    galleryGrid.append(empty);
    galleryCount.textContent = '';
    return;
  }

  galleryCount.textContent = `${photos.length} ${photos.length === 1 ? 'photograph' : 'photographs'}`;

  photos.forEach((photo, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gallery-item';
    button.setAttribute('aria-label', `Open photograph ${index + 1}`);
    const img = document.createElement('img');
    img.src = photo.url;
    img.alt = '';
    img.loading = index < 8 ? 'eager' : 'lazy';
    button.append(img);
    button.addEventListener('click', () => openLightbox(index));
    galleryGrid.append(button);
  });
}

galleryGrid.addEventListener('click', (event) => {
  const item = event.target.closest('.gallery-item');
  if (!item) return;
});

lightboxClose.addEventListener('click', closeLightbox);
lightbox.addEventListener('click', (event) => {
  if (event.target === lightbox) closeLightbox();
});
lightboxPrev.addEventListener('click', (event) => {
  event.stopPropagation();
  openLightbox(currentIndex - 1);
});
lightboxNext.addEventListener('click', (event) => {
  event.stopPropagation();
  openLightbox(currentIndex + 1);
});

document.addEventListener('keydown', (event) => {
  if (!lightbox.open) return;
  if (event.key === 'Escape') closeLightbox();
  if (event.key === 'ArrowLeft') openLightbox(currentIndex - 1);
  if (event.key === 'ArrowRight') openLightbox(currentIndex + 1);
});

fetch('/api/gallery')
  .then(readApiResponse)
  .then(({ gallery, memorialName }) => {
    if (memorialName) {
      memorialNameEl.textContent = memorialName;
      document.title = `Photo gallery | In Loving Memory of ${memorialName}`;
    }
    renderGallery(gallery);
  })
  .catch(() => {
    galleryGrid.replaceChildren();
    const empty = document.createElement('p');
    empty.className = 'wall-empty';
    empty.textContent = 'The gallery could not be loaded right now. Please try again shortly.';
    galleryGrid.append(empty);
  });
