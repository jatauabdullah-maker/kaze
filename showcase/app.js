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
      if (window.scrollY >= s.offsetTop - 110) current = s.id;
    }
    navLinks.forEach((a) => {
      a.classList.toggle("active", a.getAttribute("href") === "#" + current);
    });
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
})();
