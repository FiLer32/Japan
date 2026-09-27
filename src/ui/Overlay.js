/**
 * Loading-screen and error-screen controller (plain DOM, no three.js).
 */
export class Overlay {
  constructor() {
    this.loader = document.getElementById('loader');
    this.progress = document.getElementById('loader-progress');
    this.status = document.getElementById('loader-status');
    this.error = document.getElementById('error');
  }

  setProgress(fraction, text) {
    this.progress.style.width = `${Math.round(fraction * 100)}%`;
    if (text) this.status.textContent = text;
  }

  hideLoader() {
    this.loader.classList.add('fade');
    setTimeout(() => this.loader.classList.add('hidden'), 1000);
  }

  showError(title, message, hint = '') {
    this.loader.classList.add('hidden');
    document.getElementById('error-title').textContent = title;
    document.getElementById('error-message').textContent = message;
    document.getElementById('error-hint').textContent = hint;
    this.error.classList.remove('hidden', 'fade');
  }
}
