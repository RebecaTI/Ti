const counters = document.querySelectorAll(".counters span");
const counterSection = document.querySelector(".animation-numbers"); // Corrigido
let activated = false;

window.addEventListener("scroll", () => {
  if (
    pageYOffset > counterSection.offsetTop - counterSection.offsetHeight - 200 &&
    activated === false
  ) {
    counters.forEach(counter => {
      counter.innerText = 0;
      let count = 0;

      function updateCount() {
        const target = parseInt(counter.dataset.count);
        if (count < target) {
          count++;
          counter.innerText = count;
          setTimeout(updateCount, 10);
        } else {
          counter.innerText = target;
        }
      }

      updateCount();
      activated = true;
    });
  } else if (
    pageYOffset < counterSection.offsetTop - counterSection.offsetHeight - 500 ||
    (pageYOffset === 0 && activated === true)
  ) {
    counters.forEach(counter => {
      counter.innerText = 0;
    });
    activated = false;
  }
});