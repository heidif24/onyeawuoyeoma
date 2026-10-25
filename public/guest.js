const tributeForm = document.querySelector('#tribute-form');
const tributeMessage = document.querySelector('#tribute-message');
const characterCount = document.querySelector('#character-count');
const formStatus = document.querySelector('#form-status');
const memorialName = document.querySelector('#memorial-name');
const memorialHero = document.querySelector('#memorial-hero');
const heroCollage = document.querySelector('#hero-collage');
const publishedTributes = document.querySelector('#published-tributes');

async function readApiResponse(response) {
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error(`Tribute service unavailable (HTTP ${response.status}). Please try again later.`);
  }
  return response.json();
}

function renderCollage(collage) {
  if (!heroCollage || !memorialHero) return;
  heroCollage.replaceChildren();
  const items = Array.isArray(collage) ? collage.filter((c) => c?.url) : [];
  memorialHero.dataset.count = String(items.length);
  if (!items.length) {
    memorialHero.classList.remove('has-collage');
    return;
  }
  memorialHero.classList.add('has-collage');
  for (const item of items) {
    const cell = document.createElement('div');
    cell.className = 'collage-cell';
    const img = document.createElement('img');
    img.src = item.url;
    img.alt = '';
    img.loading = items.indexOf(item) === 0 ? 'eager' : 'lazy';
    cell.append(img);
    heroCollage.append(cell);
  }
}

function renderPublishedTributes(tributes) {
  publishedTributes.replaceChildren();
  if (!tributes.length) {
    const empty = document.createElement('p');
    empty.className = 'wall-empty';
    empty.textContent = 'As tributes are approved, shared memories will appear here.';
    publishedTributes.append(empty);
    return;
  }

  for (const tribute of tributes) {
    const article = document.createElement('article');
    article.className = 'published-tribute';
    const message = document.createElement('p');
    message.textContent = tribute.message;
    const attribution = document.createElement('p');
    attribution.className = 'tribute-attribution';
    attribution.textContent = tribute.name;
    const time = document.createElement('time');
    time.dateTime = tribute.createdAt;
    time.textContent = new Date(`${tribute.createdAt.replace(' ', 'T')}Z`).toLocaleDateString(undefined, {
      year: 'numeric', month: 'long', day: 'numeric',
    });
    article.append(message, attribution, time);
    publishedTributes.append(article);
  }
}

fetch('/api/config')
  .then(readApiResponse)
  .then(({ memorialName: name, collage, portraitUrl }) => {
    if (name) {
      memorialName.textContent = name;
      document.title = `In Loving Memory of ${name}`;
    }
    if (Array.isArray(collage) && collage.length) {
      renderCollage(collage);
    } else if (portraitUrl) {
      renderCollage([{ slot: 1, url: portraitUrl }]);
    }
  })
  .catch(() => {});

fetch('/api/tributes')
  .then(readApiResponse)
  .then(({ tributes }) => renderPublishedTributes(tributes))
  .catch(() => {});

tributeMessage.addEventListener('input', () => {
  characterCount.textContent = `${tributeMessage.value.length} / 5000`;
});

tributeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitButton = tributeForm.querySelector('button[type="submit"]');
  const formData = new FormData(tributeForm);
  submitButton.disabled = true;
  formStatus.textContent = 'Sending your words...';
  formStatus.classList.remove('is-error');

  try {
    const response = await fetch('/api/tributes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: formData.get('name'),
        message: formData.get('message'),
        consent: formData.get('consent') === 'on',
        publicConsent: formData.get('publicConsent') === 'on',
      }),
    });
    const result = await readApiResponse(response);
    if (!response.ok) throw new Error(result.error || 'Your tribute could not be sent. Please try again.');
    tributeForm.reset();
    characterCount.textContent = '0 / 5000';
    formStatus.textContent = 'Your tribute has been sent to the family for review. Thank you.';
  } catch (error) {
    formStatus.textContent = error.message || 'Your tribute could not be sent. Please try again.';
    formStatus.classList.add('is-error');
  } finally {
    submitButton.disabled = false;
  }
});
