/**
 * Renders the About section: profile photo, bio, and social links.
 * All content is real — no placeholders.
 */

const PROFILE_IMAGE_URL = "https://jamesbuckhouse.com/images/James_Buckhouse_Profile_Pic.jpg";

/** Bio HTML with all inline links preserved verbatim from the design brief. */
const BIO_HTML = `James Buckhouse believes story, art, and design can bend the arc of humanity's progress,
if you do it right, and brings that idea into everything he does: from movies to startups
to paintings to books and to <a href="https://www.instagram.com/p/CG6c1ijpwIo/" target="_blank" rel="noopener">ballets</a>.
As an artist, he has exhibited at the <a href="https://whitney.org/artists/t3540" target="_blank" rel="noopener">Whitney Biennial</a>,
the Solomon R. Guggenheim's Works &amp; Process Series, The Institute of Contemporary Art in London,
The Berkeley Art Museum, and the Dia Center. He has collaborated with leading choreographers at
the New York City Ballet, San Francisco Ballet, LA Dance Project, Oregon Ballet Theatre, and
Pennsylvania Ballet. As <a href="https://www.sequoiacap.com/people/james-buckhouse/" target="_blank" rel="noopener">Design Partner</a>
at Sequoia, he <a href="https://www.sequoiacap.com/article/seven-questions-with-james-buckhouse/" target="_blank" rel="noopener">works
with founders</a> from idea to IPO and beyond to help them design their companies, products,
cultures, and businesses. Buckhouse got his start in <a href="#/film">film</a>, lensing shots,
crafting character arcs, and punching up story for the <a href="#/film">Shrek, Madagascar, and Matrix</a>
series. He regularly guest lectures at <a href="https://buckhouse.medium.com/the-structure-of-story-reading-list-fa8308a87860" target="_blank" rel="noopener">Harvard GSD</a>,
Yale Architecture, <a href="https://www.youtube.com/watch?v=hG5i05kRYmk" target="_blank" rel="noopener">Stanford GSB</a>,
and d.school. Previously at Twitter, he authored <a href="https://read.cv/buckhouse" target="_blank" rel="noopener">UX patents</a>
for emoji replies and social opinion polls.`;

/** @type {Array<{label: string, url: string}>} */
const SOCIAL_LINKS = [
  { label: "LinkedIn",   url: "https://www.linkedin.com/in/jamesbuckhouse/" },
  { label: "Twitter / X", url: "https://x.com/buckhouse" },
  { label: "Instagram",  url: "https://www.instagram.com/buckhouse/" },
  { label: "Read.cv",    url: "https://read.cv/buckhouse" },
  { label: "Delphi",     url: "https://www.delphi.ai/buckhouse" },
  { label: "Newsletter", url: "https://jamesbuckhouse.substack.com/" },
];

export function initAboutSection() {
  const section = document.getElementById("section-about");
  if (!section) return;

  // Profile photo
  const photoEl = section.querySelector(".about-photo");
  if (photoEl instanceof HTMLImageElement) {
    photoEl.src = PROFILE_IMAGE_URL;
    photoEl.alt = "James Buckhouse";
    photoEl.classList.add("loading");
    photoEl.addEventListener("load", () => photoEl.classList.remove("loading"), { once: true });
    photoEl.addEventListener("error", () => photoEl.classList.remove("loading"), { once: true });
  }

  // Bio
  const bioEl = section.querySelector(".about-bio");
  if (bioEl) {
    bioEl.innerHTML = BIO_HTML;
  }

  // Social links
  const socialList = section.querySelector(".about-social");
  if (socialList) {
    SOCIAL_LINKS.forEach(({ label, url }) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.className = "about-social-link";
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = label;
      li.appendChild(a);
      socialList.appendChild(li);
    });
  }
}
