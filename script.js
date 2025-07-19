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

});
