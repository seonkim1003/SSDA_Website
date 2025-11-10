document.addEventListener('DOMContentLoaded', function() {

    // --- Banner Functionality ---
    const banner = document.getElementById('promo-banner');
    const closeBannerBtn = document.getElementById('close-banner');

    if (banner && closeBannerBtn) {
        closeBannerBtn.addEventListener('click', function() {
            banner.style.display = 'none';
        });
    }

    // --- Mobile Navigation Toggle ---
    const navToggle = document.querySelector('.nav-toggle');
    const navLinks = document.querySelector('.nav-links');

    if (navToggle && navLinks) {
        // Add transition class after a short delay to prevent animation on page load
        setTimeout(() => {
            navLinks.classList.add('transition-ready');
        }, 100);

        navToggle.addEventListener('click', () => {
            navLinks.classList.toggle('nav-open');
            navToggle.classList.toggle('is-active');
            document.body.classList.toggle('body-no-scroll');
        });

        // Close menu when a link is clicked
        navLinks.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', (e) => {
                // Do not close for language switcher if it's inside
                if (e.target.closest('.language-switcher')) {
                    return;
                }
                if (navLinks.classList.contains('nav-open')) {
                    navLinks.classList.remove('nav-open');
                    navToggle.classList.remove('is-active');
                    document.body.classList.remove('body-no-scroll');
                }
            });
        });
    }

    // --- Fade-in on Scroll Animation ---
    const faders = document.querySelectorAll('.fade-in');

    const appearOptions = {
        threshold: 0.1,
        rootMargin: "0px 0px -50px 0px"
    };

    const appearOnScroll = new IntersectionObserver(function(entries, appearOnScroll) {
        entries.forEach(entry => {
            if (!entry.isIntersecting) {
                return;
            } else {
                entry.target.classList.add('is-visible');
                appearOnScroll.unobserve(entry.target);
            }
        });
    }, appearOptions);

    faders.forEach(fader => {
        appearOnScroll.observe(fader);
    });

    // --- Language Switcher Functionality ---
    const languageSelect = document.getElementById('language-select');
    const translatableElements = document.querySelectorAll('[data-translate]');

    // Store original texts
    translatableElements.forEach(element => {
        element.dataset.originalText = element.innerHTML;
    });


    const updateTranslations = (language) => {
        // Handle all general translatable elements
        translatableElements.forEach(element => {
            const key = element.dataset.translate;
            if (language === 'en') {
                element.innerHTML = element.dataset.originalText;
            } else if (translations[language] && translations[language][key]) {
                // Store original text if it's not already stored
                if (!element.dataset.originalText) {
                    element.dataset.originalText = element.innerHTML;
                }
                element.innerHTML = translations[language][key];
            }
        });
    };

    const setLanguage = (language) => {
        document.documentElement.lang = language;
        localStorage.setItem('language', language);
        updateTranslations(language);
    };

    const getInitialLanguage = () => {
        const savedLanguage = localStorage.getItem('language');
        const browserLanguage = navigator.language.split('-')[0];
        return savedLanguage || (translations[browserLanguage] ? browserLanguage : 'en');
    };

    if (languageSelect) {
        const initialLanguage = getInitialLanguage();
        languageSelect.value = initialLanguage;
        setLanguage(initialLanguage);

        languageSelect.addEventListener('change', (e) => {
            setLanguage(e.target.value);
        });
    }
});