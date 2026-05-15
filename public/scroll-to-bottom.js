(function() {
    'use strict';

    if (window._scrollToBottomInitialized) return;
    window._scrollToBottomInitialized = true;

    const isMobile = window.innerWidth <= 767;

    class ScrollToBottom {
        constructor() {
            this.scrollThreshold = 200;
            this.button = null;
            this.progressBar = null;
            this.ticking = false;
            this.init();
        }

        init() {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this.setup());
            } else {
                this.setup();
            }
        }

        setup() {
            this.createButton();
            if (!this.button) return;
            this.bindEvents();
            if (!isMobile) this.updateProgress();
        }

        createButton() {
            const existing = document.querySelector('.scroll-to-bottom');
            if (existing) {
                this.button = existing;
                this.progressBar = existing.querySelector('.progress-bar');
                return;
            }

            const container = document.createElement('div');
            container.className = 'scroll-to-bottom';
            container.setAttribute('role', 'button');
            container.setAttribute('aria-label', 'Scroll to bottom');
            container.setAttribute('tabindex', '0');

            const circumferenceValue = 2 * Math.PI * 22;

            container.innerHTML = `
                <svg class="scroll-progress-ring" viewBox="0 0 50 50">
                    <circle class="progress-bg" cx="25" cy="25" r="22"></circle>
                    <circle class="progress-bar" cx="25" cy="25" r="22"></circle>
                </svg>
                <button class="scroll-to-bottom-btn" aria-hidden="true">
                    <i class="fas fa-arrow-down"></i>
                </button>
            `;

            document.body.appendChild(container);

            this.button = container;
            this.progressBar = container.querySelector('.progress-bar');
            this.progressBar.style.strokeDasharray = circumferenceValue;
            this.progressBar.style.strokeDashoffset = circumferenceValue;
        }

        bindEvents() {
            const scrollTarget = window;
            scrollTarget.addEventListener('scroll', () => this.onScroll(), { passive: true });

            if (this.button) {
                this.button.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.scrollToBottom();
                });
                this.button.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        this.scrollToBottom();
                    }
                });
            }
        }

        onScroll() {
            if (!this.ticking) {
                window.requestAnimationFrame(() => {
                    this.updateVisibility();
                    if (!isMobile) this.updateProgress();
                    this.ticking = false;
                });
                this.ticking = true;
            }
        }

        updateVisibility() {
            if (!this.button) return;
            const scrollY = window.scrollY || window.pageYOffset;
            const documentHeight = document.documentElement.scrollHeight - window.innerHeight;
            if (scrollY < documentHeight - this.scrollThreshold) {
                this.button.classList.add('visible');
            } else {
                this.button.classList.remove('visible');
            }
        }

        updateProgress() {
            if (!this.progressBar) return;
            const scrollY = window.scrollY || window.pageYOffset;
            const documentHeight = document.documentElement.scrollHeight - window.innerHeight;
            if (documentHeight <= 0) return;
            const scrollPercent = Math.min(scrollY / documentHeight, 1);
            const circumference = 2 * Math.PI * 22;
            this.progressBar.style.strokeDashoffset = circumference * (1 - scrollPercent);
        }

        scrollToBottom() {
            const startPosition = window.scrollY || window.pageYOffset;
            const targetPosition = document.documentElement.scrollHeight - window.innerHeight;
            const distance = targetPosition - startPosition;

            if (isMobile) {
                window.scrollTo({ top: targetPosition, behavior: 'smooth' });
                return;
            }

            const duration = Math.min(600, Math.abs(distance) / 3);
            const startTime = performance.now();
            const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
            const animateScroll = (currentTime) => {
                const elapsed = currentTime - startTime;
                const progress = Math.min(elapsed / duration, 1);
                window.scrollTo(0, startPosition + distance * easeOutCubic(progress));
                if (progress < 1) requestAnimationFrame(animateScroll);
            };
            requestAnimationFrame(animateScroll);
        }
    }

    window.ScrollToBottom = ScrollToBottom;
    new ScrollToBottom();
})();
