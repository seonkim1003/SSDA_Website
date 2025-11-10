document.addEventListener('DOMContentLoaded', function() {

    // --- Banner Functionality ---
    const banner = document.getElementById('promo-banner');
    const closeBannerBtn = document.getElementById('close-banner');

    if (banner && closeBannerBtn) {
        closeBannerBtn.addEventListener('click', function() {
            banner.style.display = 'none';
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

    const updateTranslations = (language) => {
        translatableElements.forEach(element => {
            const key = element.dataset.translate;
            if (translations[language] && translations[language][key]) {
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
