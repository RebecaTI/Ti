function isElementinViewport(element, threshold = 0.2) {

  const elementRect = element.getBoundingClientRect();
  const windowHeight = window.innerHeight;

  return (elementRect.top + (elementRect.height * threshold) < windowHeight && elementRect.bottom - (elementRect.height * threshold) > 0);
}

function scrollAnimation() {
  const elementos = document.querySelectorAll('[data-scroll-animation], [data-scroll-animation-once]');

  window.addEventListener('scroll', () => {
    elementos.forEach(elemento => {
      const isVisible = isElementinViewport(elemento);

      if (isVisible) {
        elemento.classList.add('visivel');

        if (elemento.hasAttribute('data-scroll-animation-once')) {
          elemento.classList.add('visto');
          elemento.removeEventListener('scroll', scrollAnimation);
        }
      } else {
        elemento.classList.remove('visivel');
      }
    })
  });
}

scrollAnimation();

