"use strict";

(function () {
  const topbar = document.querySelector(".topbar");
  const navLinks = document.querySelectorAll(".nav a");
  const sections = ["anime", "video", "how", "setup", "help"]
    .map((id) => document.getElementById(id))
    .filter(Boolean);

  function onScroll() {
    if (window.scrollY > 8) topbar.classList.add("scrolled");
    else topbar.classList.remove("scrolled");

    let current = "";
    for (const s of sections) {
      if (window.scrollY >= s.offsetTop - 120) current = s.id;
    }
    navLinks.forEach((a) => {
      a.classList.toggle("active", a.getAttribute("href") === "#" + current);
    });
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // Reveal on scroll
  const revealObserver = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (en.isIntersecting) {
        en.target.classList.add("in");
        revealObserver.unobserve(en.target);
      }
    }
  }, { threshold: 0.12 });
  document.querySelectorAll(".product-row, .how, .setup, .help-item, .hero-stats, .section-head-wrap").forEach((n) => {
    n.classList.add("reveal");
    revealObserver.observe(n);
  });

  // Animate the mockup progress bar to 64% when it scrolls into view
  const barFill = document.querySelector(".bar-fill");
  if (barFill) {
    const barObs = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (en.isIntersecting) {
          barFill.style.width = "64%";
          barObs.unobserve(en.target);
        }
      }
    }, { threshold: 0.4 });
    barObs.observe(barFill.closest(".win-row"));
  }

  // Help accordion
  document.querySelectorAll(".help-item").forEach((item) => {
    const q = item.querySelector(".help-q");
    const a = item.querySelector(".help-a");
    q.addEventListener("click", () => {
      const isOpen = item.classList.contains("open");
      document.querySelectorAll(".help-item.open").forEach((other) => {
        other.classList.remove("open");
        other.querySelector(".help-a").style.maxHeight = null;
        other.querySelector(".help-q").setAttribute("aria-expanded", "false");
      });
      if (!isOpen) {
        item.classList.add("open");
        a.style.maxHeight = a.scrollHeight + "px";
        q.setAttribute("aria-expanded", "true");
      }
    });
  });
})();
